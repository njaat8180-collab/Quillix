/**
 * Shared helper: resolve the real Windows artifact names for the packaged app.
 *
 * WHY THIS EXISTS
 * ---------------
 * `electron-builder.json` sets `"productName": "NUVRO AI"`, so electron-builder
 * emits:
 *   - the unpacked executable  -> `NUVRO AI.exe`
 *   - the NSIS installer       -> `NUVRO AI Setup 1.2.0.exe`
 *   - the portable executable  -> `NUVRO AI 1.2.0.exe`
 *
 * The release gates (`test:release-artifact`, `test:packaged-static`) used to
 * hardcode the old `Quillix*.exe` names. After the product rename the gates
 * failed with "Installer missing" / "unpacked Quillix executable is missing"
 * even though `package:win` had produced a perfectly valid installer.
 *
 * These helpers derive the expected names from the actual builder config so
 * the gates verify the REAL artifact instead of a stale hardcoded string.
 */
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_VERSION = '1.2.0';

/** Read `productName` and `version` from the builder config + package.json. */
export function readProductIdentity(projectRoot) {
  let productName = 'Quillix';
  let version = DEFAULT_VERSION;
  try {
    const builder = JSON.parse(fs.readFileSync(path.join(projectRoot, 'electron-builder.json'), 'utf8'));
    if (typeof builder.productName === 'string' && builder.productName.trim()) {
      productName = builder.productName.trim();
    }
  } catch { /* fall back to the default */ }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    if (typeof pkg.version === 'string' && pkg.version.trim()) version = pkg.version.trim();
  } catch { /* fall back to the default */ }
  return { productName, version };
}

/**
 * Expected artifact names for a packaging target.
 * `nsis` -> "NUVRO AI Setup 1.2.0.exe", `portable` -> "NUVRO AI 1.2.0.exe".
 */
export function expectedArtifactNames(projectRoot, target) {
  const { productName, version } = readProductIdentity(projectRoot);
  return {
    productName,
    version,
    unpackedExecutable: `${productName}.exe`,
    installer: target === 'portable' ? `${productName} ${version}.exe` : `${productName} Setup ${version}.exe`,
  };
}

/**
 * Locate the installer in the release directory.
 *
 * Prefers the exact expected name, then accepts the legacy `Quillix*.exe`
 * spelling so an artifact produced before the rename is still verifiable.
 */
export function resolveInstaller(releaseRoot, projectRoot, target) {
  const expected = expectedArtifactNames(projectRoot, target);
  const candidates = target === 'portable'
    ? [expected.installer, 'Quillix 1.2.0.exe', 'Quillix.exe']
    : [expected.installer, 'Quillix Setup 1.2.0.exe'];
  for (const name of candidates) {
    const candidate = path.join(releaseRoot, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(releaseRoot, expected.installer);
}

/**
 * Locate the unpacked executable in the release directory.
 * Prefers the expected product name, then accepts the legacy spelling.
 */
export function resolveUnpackedExecutable(unpackedDir, projectRoot) {
  const expected = expectedArtifactNames(projectRoot, 'nsis');
  const candidates = [expected.unpackedExecutable, 'Quillix.exe'];
  for (const name of candidates) {
    const candidate = path.join(unpackedDir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(unpackedDir, expected.unpackedExecutable);
}
