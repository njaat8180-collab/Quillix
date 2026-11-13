import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkspaceManager } from './workspace.js';
import type { EditorProjectSnapshot } from '../shared/editorProject.js';

const SKIP = new Set(['node_modules', 'dist', 'build', 'target', 'vendor', 'coverage', 'bin', 'obj', 'venv', '__pycache__']);
const PRIVATE_NAME = /^(?:credentials?|secrets?|tokens?|private[-_]keys?)(?:[._-]|$)/i;
export const EDITOR_PROJECT_LIMITS = { files: 128, fileBytes: 64 * 1024, totalBytes: 2 * 1024 * 1024, entries: 3000, directories: 200, depth: 10 };

/** Fresh, local-only source snapshot. No source execution, package fetching or secret reads. */
export async function collectEditorProject(workspace: WorkspaceManager): Promise<EditorProjectSnapshot> {
  const root = workspace.getRoot();
  // Freeze the root for this request even if another request switches the workspace.
  const reader = new WorkspaceManager(root);
  const report: EditorProjectSnapshot = { root, files: [], limited: false, scannedEntries: 0, readBytes: 0 };
  const dirs = ['.'];
  for (let index = 0; index < dirs.length; index++) {
    const safe = reader.resolveSafePath(dirs[index]);
    if (!safe.safe) continue;
    try {
      const directory = await fs.opendir(safe.fullPath);
      for await (const entry of directory) {
        if (++report.scannedEntries > EDITOR_PROJECT_LIMITS.entries) { report.limited = true; return report; }
        if (entry.name.startsWith('.') || SKIP.has(entry.name) || PRIVATE_NAME.test(entry.name) || entry.isSymbolicLink()) continue;
        const relative = path.posix.join(dirs[index], entry.name);
        if (entry.isDirectory()) {
          if (dirs.length < EDITOR_PROJECT_LIMITS.directories && relative.split('/').length < EDITOR_PROJECT_LIMITS.depth) dirs.push(relative);
          else report.limited = true;
          continue;
        }
        if (!entry.isFile() || !/\.(?:[cm]?[jt]sx?)$/i.test(relative) || WorkspaceManager.isSecretPath(relative)) continue;
        const file = reader.resolveSafePath(relative);
        if (!file.safe) continue;
        try {
          const stat = await fs.lstat(file.fullPath);
          if (!stat.isFile() || stat.isSymbolicLink() || WorkspaceManager.isSecretPath(await fs.realpath(file.fullPath))) continue;
          if (stat.size > EDITOR_PROJECT_LIMITS.fileBytes) { report.limited = true; continue; }
          if (report.readBytes + stat.size > EDITOR_PROJECT_LIMITS.totalBytes || report.files.length >= EDITOR_PROJECT_LIMITS.files) {
            report.limited = true; return report;
          }
          const read = reader.readFile(relative);
          if (!read.success || read.content === undefined || read.content.includes('\0')) continue;
          // Recheck actual bytes: files may grow between metadata and the safe reader.
          const bytes = Buffer.byteLength(read.content);
          if (bytes > EDITOR_PROJECT_LIMITS.fileBytes || report.readBytes + bytes > EDITOR_PROJECT_LIMITS.totalBytes) { report.limited = true; continue; }
          report.readBytes += bytes;
          report.files.push({ filePath: relative, content: reader.redactSecrets(read.content) });
        } catch { /* Removed/unreadable files are not evidence. */ }
      }
    } catch { /* Skip unreadable folders. */ }
  }
  report.files.sort((a, b) => a.filePath.localeCompare(b.filePath));
  return report;
}
