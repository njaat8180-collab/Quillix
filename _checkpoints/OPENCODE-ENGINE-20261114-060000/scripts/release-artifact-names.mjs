import fs from 'node:fs';
import path from 'node:path';

// The release gates must verify the artifact the PACKAGER actually produces.
// electron-builder derives the installer and executable names from
// electron-builder.json (productName and optional artifactName templates) and
// package.json (version). A hardcoded brand string drifts out of sync with
// that configuration and the release gate can then never pass — it reports a
// missing installer for a file that was just built. Read the same
// configuration the packager uses and keep the legacy names as fallbacks so an
// artifact built before a rename still verifies.
const DEFAULT_PRODUCT_NAME = 'Quillix';
const DEFAULT_VERSION = '0.0.0';

function readJson(root, file) {
  try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); } catch { return undefined; }
}

function expand(template, vars) {
  return String(template).replace(/\$\{(\w+)\}/g, (match, key) => (key in vars ? vars[key] : match));
}

/**
 * Candidate artifact names for the Windows release, most specific first.
 * `nsis` matches the installer, `portable` the single-file executable and
 * `executable` the unpacked app inside win-unpacked.
 */
export function releaseArtifactNames(root = process.cwd()) {
  const builder = readJson(root, 'electron-builder.json') || {};
  const pkg = readJson(root, 'package.json') || {};
  const productName = typeof builder.productName === 'string' && builder.productName.trim()
    ? builder.productName.trim()
    : DEFAULT_PRODUCT_NAME;
  const version = typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version.trim() : DEFAULT_VERSION;
  const vars = { productName, version, name: productName, arch: 'x64', os: 'win', channel: 'latest' };

  const winArtifactName = builder.win && builder.win.artifactName;
  const nsisTemplate = (builder.nsis && builder.nsis.artifactName) || winArtifactName || '${productName} Setup ${version}.exe';
  const portableTemplate = (builder.portable && builder.portable.artifactName) || winArtifactName || '${productName} ${version}.exe';

  const nsis = [expand(nsisTemplate, vars), 'Quillix Setup 1.2.0.exe'];
  const portable = [expand(portableTemplate, vars), `${productName}.exe`, 'Quillix 1.2.0.exe', 'Quillix.exe'];
  const executable = [`${productName}.exe`, 'Quillix.exe'];
  const unique = names => [...new Set(names.filter(Boolean))];
  return { productName, version, nsis: unique(nsis), portable: unique(portable), executable: unique(executable) };
}

/**
 * First candidate that exists on disk; otherwise the preferred (first) name,
 * so a missing artifact is reported against the path the packager would use.
 */
export function firstExistingArtifact(directory, candidates) {
  for (const name of candidates) {
    const full = path.join(directory, name);
    if (fs.existsSync(full)) return full;
  }
  return path.join(directory, candidates[0]);
}
