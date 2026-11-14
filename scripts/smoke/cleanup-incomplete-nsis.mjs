import fs from 'node:fs';
import path from 'node:path';

const MIN_VALID_NSIS_BYTES = 10 * 1024 * 1024;

// The NSIS installer is named after the builder productName. Hardcoding the
// old "Quillix" spelling meant this cleanup never matched the real
// "NUVRO AI Setup 1.2.0.exe" output, so an incomplete installer was left in
// the release directory instead of being removed.
function nsisInstallerNames() {
  let productName = 'Quillix';
  let version = '1.2.0';
  try {
    const builder = JSON.parse(fs.readFileSync(path.resolve('electron-builder.json'), 'utf8'));
    if (typeof builder.productName === 'string' && builder.productName.trim()) productName = builder.productName.trim();
  } catch { /* fall back to the default */ }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    if (typeof pkg.version === 'string' && pkg.version.trim()) version = pkg.version.trim();
  } catch { /* fall back to the default */ }
  return [`${productName} Setup ${version}.exe`, 'Quillix Setup 1.2.0.exe'];
}

/** Remove only a plainly incomplete generated NSIS output; keep valid installers untouched. */
export function cleanupIncompleteNsisArtifacts(outputDir) {
  const directory = path.resolve(outputDir);
  const removed = [];

  for (const name of nsisInstallerNames()) {
    const installer = path.join(directory, name);
    let info;
    try {
      info = fs.lstatSync(installer);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (!info.isFile() || info.size >= MIN_VALID_NSIS_BYTES) continue;

    fs.rmSync(installer);
    removed.push(installer);

    const blockmap = path.join(directory, `${name}.blockmap`);
    try {
      if (fs.lstatSync(blockmap).isFile()) {
        fs.rmSync(blockmap);
        removed.push(blockmap);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return removed;
}
