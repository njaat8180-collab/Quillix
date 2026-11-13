import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const candidates = process.platform === 'win32'
  ? [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
      'bash',
    ]
  : ['bash'];
const bash = candidates.find((candidate) => candidate === 'bash' || fs.existsSync(candidate));

if (!bash) {
  console.error('Git Bash is required for the agent E2E harness on Windows. Install Git for Windows and retry.');
  process.exit(1);
}

const getFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    server.close(() => resolve(port));
  });
});

const main = async () => {
  const [port, mockPort] = await Promise.all([
    process.env.QUILLIX_E2E_PORT ? Number(process.env.QUILLIX_E2E_PORT) : getFreePort(),
    process.env.QUILLIX_E2E_MOCK_PORT ? Number(process.env.QUILLIX_E2E_MOCK_PORT) : getFreePort(),
  ]);
  const result = spawnSync(bash, ['scripts/e2e/agent-e2e.sh'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CHERE_INVOKING: '1',
      QUILLIX_E2E_PORT: String(port),
      QUILLIX_E2E_MOCK_PORT: String(mockPort),
    },
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`Unable to start the agent E2E harness: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
};

main().catch((error) => {
  console.error(`Unable to allocate isolated E2E ports: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
