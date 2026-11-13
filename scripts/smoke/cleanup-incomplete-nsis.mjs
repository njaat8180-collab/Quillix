import fs from 'node:fs';
import path from 'node:path';

const MIN_VALID_NSIS_BYTES = 10 * 1024 * 1024;
const NSIS_INSTALLER = 'Quillix Setup 1.2.0.exe';
const NSIS_BLOCKMAP = `${NSIS_INSTALLER}.blockmap`;

/** Remove only a plainly incomplete generated NSIS output; keep valid installers untouched. */
export function cleanupIncompleteNsisArtifacts(outputDir) {
  const directory = path.resolve(outputDir);
  const installer = path.join(directory, NSIS_INSTALLER);
  let info;
  try {
    info = fs.lstatSync(installer);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  if (!info.isFile() || info.size >= MIN_VALID_NSIS_BYTES) return [];

  const removed = [];
  fs.rmSync(installer);
  removed.push(installer);

  const blockmap = path.join(directory, NSIS_BLOCKMAP);
  try {
    if (fs.lstatSync(blockmap).isFile()) {
      fs.rmSync(blockmap);
      removed.push(blockmap);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return removed;
}
