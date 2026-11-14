/**
 * Portable source export for Electron on Windows, macOS and Linux.
 * Uses only Node's built-ins; no Python, shell, network or external ZIP tools.
 */
import fs from 'node:fs';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';

const OMIT_DIRECTORIES = new Set([
  '.git', '.quillix', 'node_modules', 'dist', 'build', 'coverage', '.vite',
  '.next', '.venv', 'venv', '.idea', '__pycache__', '.quillix-smoke',
]);
const OMIT_FILES = new Set(['.env', '.npmrc', '.netrc', '.DS_Store', 'Thumbs.db']);
const MAX_FILES = 5_000;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

function crc32(input: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function excludedFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith('.env') || lower.endsWith('.key') || lower.endsWith('.pem') ||
    lower.endsWith('.p12') || lower.endsWith('.pfx') || lower.endsWith('.log') ||
    lower.endsWith('.zip') || OMIT_FILES.has(lower) ||
    /^(?:id_rsa|id_ed25519|id_ecdsa|secrets|credentials)(?:\.|$)/i.test(name);
}

/** Generates a standard ZIP with UTF-8 file names, no timestamps and no symlinks. */
export function buildSourceArchive(root: string): Buffer {
  const base = fs.realpathSync(root);
  const entries: Array<{ name: string; data: Buffer }> = [];
  let totalSize = 0;
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      // Never follow symlinks. Besides preventing escape, this avoids cycles.
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!OMIT_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.quillix')) visit(full);
      } else if (entry.isFile() && !excludedFile(entry.name)) {
        const stat = fs.statSync(full);
        if (stat.size > MAX_FILE_BYTES) throw new Error(`Source export: file too large (${entry.name}).`);
        totalSize += stat.size;
        if (entries.length >= MAX_FILES || totalSize > MAX_SOURCE_BYTES) {
          throw new Error('Source export exceeded its safe size/file limit (64 MiB, 5000 files).');
        }
        const name = path.relative(base, full).split(path.sep).join('/');
        entries.push({ name, data: fs.readFileSync(full) });
      }
    }
  };
  visit(base);
  if (entries.length === 0) throw new Error('No source files available for export.');

  const fileRecords: Buffer[] = [];
  const directoryRecords: Buffer[] = [];
  let offset = 0;
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.data);
    const checksum = crc32(entry.data);
    const fileHeader = Buffer.alloc(30);
    fileHeader.writeUInt32LE(0x04034b50, 0);
    fileHeader.writeUInt16LE(20, 4);
    fileHeader.writeUInt16LE(0x0800, 6); // UTF-8 names
    fileHeader.writeUInt16LE(8, 8); // Deflate
    fileHeader.writeUInt32LE(checksum, 14);
    fileHeader.writeUInt32LE(compressed.length, 18);
    fileHeader.writeUInt32LE(entry.data.length, 22);
    fileHeader.writeUInt16LE(name.length, 26);
    fileRecords.push(fileHeader, name, compressed);

    const center = Buffer.alloc(46);
    center.writeUInt32LE(0x02014b50, 0);
    center.writeUInt16LE(20, 4);
    center.writeUInt16LE(20, 6);
    center.writeUInt16LE(0x0800, 8);
    center.writeUInt16LE(8, 10);
    center.writeUInt32LE(checksum, 16);
    center.writeUInt32LE(compressed.length, 20);
    center.writeUInt32LE(entry.data.length, 24);
    center.writeUInt16LE(name.length, 28);
    center.writeUInt32LE(offset, 42);
    directoryRecords.push(center, name);
    offset += fileHeader.length + name.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(directoryRecords);
  const trailer = Buffer.alloc(22);
  trailer.writeUInt32LE(0x06054b50, 0);
  trailer.writeUInt16LE(entries.length, 8);
  trailer.writeUInt16LE(entries.length, 10);
  trailer.writeUInt32LE(centralDirectory.length, 12);
  trailer.writeUInt32LE(offset, 16);
  const archive = Buffer.concat([...fileRecords, centralDirectory, trailer]);
  if (archive.length > MAX_ARCHIVE_BYTES) throw new Error('Source ZIP exceeded 64 MiB.');
  return archive;
}
