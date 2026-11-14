/**
 * E2E-only polyfill: replaces global fetch with a pure node:http client so the
 * Quillix server can talk to the mock Ollama in a sandbox where Node's undici
 * fetch cannot allocate its llhttp WASM memory. NOT part of the shipped app —
 * used only by the E2E driver via `node --require`.
 */
const http = require('http');
const https = require('https');
const { PassThrough } = require('stream');

class Reader {
  constructor(stream) {
    this.queue = [];
    this.waiting = [];
    this.done = false;
    stream.on('data', (chunk) => {
      const value = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      const waiter = this.waiting.shift();
      if (waiter) waiter.resolve({ value, done: false });
      else this.queue.push({ value, done: false });
    });
    stream.on('end', () => {
      this.done = true;
      const waiter = this.waiting.shift();
      if (waiter) waiter.resolve({ value: undefined, done: true });
      else this.queue.push({ value: undefined, done: true });
    });
    stream.on('error', (err) => {
      const waiter = this.waiting.shift();
      if (waiter) waiter.reject(err);
      else this.queue.push(Promise.reject(err));
    });
  }
  read() {
    if (this.queue.length) {
      const next = this.queue.shift();
      return next instanceof Promise ? next : Promise.resolve(next);
    }
    if (this.done) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }
  cancel() {
    this.done = true;
  }
}

globalThis.fetch = function fetch(url, init = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return reject(new TypeError('Invalid URL'));
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: init.method || 'GET',
        headers: init.headers || {},
      },
      (res) => {
        const chunks = [];
        const tee = new PassThrough();
        res.on('data', (c) => chunks.push(c));
        res.pipe(tee);

        const waitForEnd = () =>
          new Promise((resolve2, reject2) => {
            if (res.complete) return resolve2();
            res.once('end', resolve2);
            res.once('error', reject2);
          });

        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          async text() {
            await waitForEnd();
            return Buffer.concat(chunks).toString('utf8');
          },
          async json() {
            await waitForEnd();
            return JSON.parse(Buffer.concat(chunks).toString('utf8'));
          },
          body: {
            getReader: () => new Reader(tee),
          },
        });
      }
    );
    req.on('error', (err) => {
      const e = new Error(err.message || 'fetch failed');
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
        e.name = 'TypeError';
      }
      reject(e);
    });
    if (init.signal) {
      if (init.signal.aborted) {
        req.destroy();
        const e = new Error('Ollama generation was cancelled.');
        e.name = 'AbortError';
        return reject(e);
      }
      init.signal.addEventListener(
        'abort',
        () => {
          req.destroy();
          const e = new Error('Ollama generation was cancelled.');
          e.name = 'AbortError';
          reject(e);
        },
        { once: true }
      );
    }
    if (init.body) req.write(init.body);
    req.end();
  });
};
