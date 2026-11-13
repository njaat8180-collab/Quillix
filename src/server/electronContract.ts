/** Narrow, verifier-backed repair for explicit Electron BrowserWindow size requests. */
export function repairElectronWindowContract(source: string, width: number, height: number): { content: string; changed: boolean } {
  if (source.length > 512 * 1024 || !/BrowserWindow\s*\(/.test(source)) return { content: source, changed: false };
  let content = source.replace(/(BrowserWindow\s*\(\s*\{[^{}]*?\bwidth\s*:\s*)\d+(?=[^{}]*?\bheight\s*:)/s, `$1${width}`)
    .replace(/(BrowserWindow\s*\(\s*\{[^{}]*?\bheight\s*:\s*)\d+/s, `$1${height}`);
  // Preserve the explicit Electron lifecycle contract if a model rewrites the
  // equivalent callback form during a focused dimension repair.
  if (/app\.whenReady\s*\(\s*\(\)\s*=>\s*createWindow\s*\(\s*\)\s*\)/.test(content) && !/app\.whenReady\s*\(\s*\)\s*\.then\s*\(\s*createWindow\s*\)/.test(content)) {
    content = content.replace(/app\.whenReady\s*\(\s*\(\)\s*=>\s*createWindow\s*\(\s*\)\s*\)\s*;?/, 'app.whenReady().then(createWindow);');
  }
  return { content, changed: content !== source };
}
