/**
 * Live verification that the fault policy behaves as documented, against the
 * REAL built server (dist/server.cjs):
 *
 *   - an unhandled rejection keeps the server ALIVE and serving
 *   - an uncaught exception is FATAL: the server cleans up and EXITS
 *
 * The fault is injected into the server process itself with NODE_OPTIONS
 * --require, so the server's own bundled fault reporter handles it. There
 * are no mocks and no stubs.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..', '..');
const ENTRY = path.join(ROOT, 'dist', 'server.cjs');

if (!fs.existsSync(ENTRY)) {
  console.error('FAIL: dist/server.cjs not found — run npm run build first.');
  process.exit(1);
}

const PORT = 3397;
const URL = `http://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${URL}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch { /* still booting */ }
    await sleep(300);
  }
  return false;
}

/** Write a preload module that raises the requested fault inside the server. */
function writeProbe(kind, file) {
  const body = kind === 'rejection'
    ? `Promise.reject(new Error('codevian-live-probe: unhandled rejection'));`
    : `throw new Error('codevian-live-probe: uncaught exception');`;
  fs.writeFileSync(
    file,
    `setTimeout(() => { try { ${body} } catch (e) { throw e; } }, 15000);\n`,
  );
  return file;
}

function runScenario(name, kind, expectAlive) {
  return new Promise((resolve) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-fault-'));
    const probe = writeProbe(kind, path.join(dir, 'probe.cjs'));

    const child = spawn(process.execPath, [ENTRY], {
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: 'production',
        NODE_OPTIONS: `--require ${probe}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.stdout.on('data', () => {});

    let exitInfo = null;
    child.on('exit', (code, signal) => { exitInfo = { code, signal }; });

    (async () => {
      const ready = await waitReady();
      if (!ready) {
        try { child.kill(); } catch { /* ignore */ }
        resolve({ name, ok: false, reason: 'server did not become ready' });
        return;
      }

      // The probe fires 15 s after start; wait past that.
      await sleep(17000);

      let stillServing = false;
      try {
        const res = await fetch(`${URL}/api/health`, { signal: AbortSignal.timeout(1500) });
        stillServing = res.ok;
      } catch { /* not serving */ }

      const alive = exitInfo === null;

      if (expectAlive) {
        if (alive && stillServing) {
          try { child.kill(); } catch { /* ignore */ }
          resolve({ name, ok: true, detail: 'process still alive and still serving' });
        } else {
          try { child.kill(); } catch { /* ignore */ }
          resolve({
            name,
            ok: false,
            reason: `expected alive+serving, alive=${alive} serving=${stillServing}`,
            stderrTail: stderr.slice(-800),
          });
        }
        return;
      }

      // Fatal scenario: the process must have exited on its own.
      if (!alive) {
        resolve({
          name,
          ok: true,
          detail: `process exited on its own (code=${exitInfo.code}, signal=${exitInfo.signal})`,
          reportedFault: /uncaught exception/i.test(stderr),
          stderrTail: stderr.slice(-500),
        });
      } else {
        try { child.kill(); } catch { /* ignore */ }
        resolve({
          name,
          ok: false,
          reason: 'process stayed alive after an uncaught exception',
          stderrTail: stderr.slice(-800),
        });
      }
    })();
  });
}

(async () => {
  const rejection = await runScenario(
    'unhandled rejection keeps the server alive and serving',
    'rejection',
    true,
  );
  const exception = await runScenario(
    'uncaught exception terminates the server',
    'exception',
    false,
  );

  console.log('');
  console.log('  ' + (rejection.ok ? 'PASS' : 'FAIL') + '  ' + rejection.name + ' — ' + (rejection.detail || rejection.reason));
  console.log('  ' + (exception.ok ? 'PASS' : 'FAIL') + '  ' + exception.name + ' — ' + (exception.detail || exception.reason));

  if (exception.ok && exception.reportedFault === false) {
    console.log('  FAIL  the fatal fault was not reported with an "uncaught exception" log line');
  }

  const ok = rejection.ok && exception.ok && exception.reportedFault !== false;
  console.log('');
  console.log(ok ? 'PASS: fault policy verified live against the built server.' : 'FAIL: fault policy verification failed.');
  process.exit(ok ? 0 : 1);
})();
