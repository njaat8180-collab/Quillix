/**
 * fetch shim for integration verification on constrained runtimes.
 *
 * The verification sandbox cannot instantiate the WASM inside Node's built-in
 * undici fetch (llhttp). The NUVRO AI server only needs plain HTTP against
 * 127.0.0.1, so a minimal node:http-based fetch is fully equivalent for the
 * tests. On normal machines (and in production) the native fetch is untouched
 * — this shim is ONLY imported by scripts/integration-verify.ts.
 */
import http from 'http';
import { Readable } from 'stream';

type ShimInit = RequestInit & { signal?: AbortSignal };

export function installFetchShim(): void {
  (globalThis as any).fetch = (url: string, init: ShimInit = {}): Promise<any> =>
    new Promise((resolve, reject) => {
      let u: URL;
      try {
        u = new URL(url);
      } catch (err: any) {
        return reject(err);
      }
      const req = http.request(
        {
          hostname: u.hostname,
          port: u.port || 80,
          path: u.pathname + u.search,
          method: (init.method as string) || 'GET',
          headers: (init.headers as Record<string, string>) || {},
        },
        (res) => {
          const status = res.statusCode || 500;
          // Always buffer the full body up front: on fast loopback responses
          // the 'data'/'end' events can fire before the caller attaches its
          // own listeners, so text() must serve from this buffer.
          let raw = '';
          res.setEncoding('utf8');
          const done = new Promise<void>((r2) => {
            res.on('data', (c: string) => (raw += c));
            res.on('end', () => r2());
            res.on('error', () => r2());
          });
          const text = () => done.then(() => raw);
          // Hand-rolled web stream for streaming callers (qwen.ts) — chunks
          // are retained in the stream queue for later readers.
          const webStream = new ReadableStream<Uint8Array>({
            start(controller) {
              res.on('data', (c: string) => {
                try {
                  controller.enqueue(Buffer.from(c, 'utf8'));
                } catch {
                  /* stream already closed */
                }
              });
              res.on('end', () => {
                try {
                  controller.close();
                } catch {
                  /* already closed */
                }
              });
              res.on('error', (err: Error) => {
                try {
                  controller.error(err);
                } catch {
                  /* already closed */
                }
              });
            },
            cancel() {
              res.destroy();
            },
          });
          resolve({
            ok: status >= 200 && status < 300,
            status,
            statusText: res.statusMessage || '',
            text,
            json: async () => JSON.parse(await text()),
            body: webStream,
          });
        }
      );

      req.on('error', (err: Error) => {
        if (/cancelled/i.test(err.message || '')) {
          reject(Object.assign(new Error(err.message), { name: 'AbortError' }));
        } else {
          reject(new TypeError(err.message));
        }
      });

      if (init.signal) {
        const signal = init.signal as AbortSignal;
        if (signal.aborted) {
          req.destroy(new Error('Ollama generation was cancelled.'));
        } else {
          signal.addEventListener(
            'abort',
            () => req.destroy(new Error('Ollama generation was cancelled.')),
            { once: true }
          );
        }
      }

      if (init.body != null) req.write(init.body);
      req.end();
    });
}
