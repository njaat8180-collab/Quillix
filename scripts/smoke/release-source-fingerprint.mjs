import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const fixedInputs = [
  'server.ts', 'index.html', 'package.json', 'package-lock.json', 'electron-builder.json',
  'vite.config.ts', 'tsconfig.json', 'metadata.json', 'build/icon.png',
];
const sourceDirectories = ['src', 'electron', 'knowledge'];
const ignoredDirectoryNames = new Set(['__tests__', 'node_modules', 'dist', 'release']);

function collectFiles(root, relativePath, files) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return;
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) {
    files.add(relativePath.replace(/\\/g, '/'));
    return;
  }
  if (!stat.isDirectory() || ignoredDirectoryNames.has(path.basename(relativePath))) return;
  for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) continue;
    const child = path.join(relativePath, entry.name);
    if (entry.isFile() && /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(entry.name)) continue;
    collectFiles(root, child, files);
  }
}

/** Hash the shipped runtime inputs so an old installer cannot satisfy current release checks. */
export function releaseSourceFingerprint(root = process.cwd()) {
  const files = new Set();
  for (const input of fixedInputs) collectFiles(root, input, files);
  for (const directory of sourceDirectories) collectFiles(root, directory, files);
  const hash = crypto.createHash('sha256');
  for (const relativePath of [...files].sort()) {
    hash.update(relativePath).update('\0');
    hash.update(fs.readFileSync(path.join(root, relativePath))).update('\0');
  }
  return hash.digest('hex');
}
