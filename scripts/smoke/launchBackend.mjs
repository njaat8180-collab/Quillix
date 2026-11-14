/** Backend QA launcher: emitted TypeScript uses ES modules while production
 * electron-builder creates CJS. Supply the bundle's dirname for parity. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const currentDir = path.dirname(fileURLToPath(import.meta.url));
globalThis.__dirname = path.resolve(currentDir, '../../.qa-dist');
await import('../../.qa-dist/server.js');
