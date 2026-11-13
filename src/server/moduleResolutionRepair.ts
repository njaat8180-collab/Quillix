import fs from 'node:fs';
import path from 'node:path';

/** Repair one unambiguous relative CommonJS import whose real file has an extension. */
export function repairMissingRelativeModule(sourceFile: string, source: string, diagnostic: string, workspaceRoot: string): { content: string; changed: boolean; resolved: string } | undefined {
  const diagnosticMatch = diagnostic.match(/Cannot find module ['"]([^'"]+)['"]/i);
  const mentioned = diagnosticMatch?.[1];
  const imports = [...source.matchAll(/(?:require\s*\(|from\s+|import\s*\()\s*['"](\.[^'"]+)['"]/g)]
    .map(match => match[1])
    .filter(specifier => specifier.startsWith('.') && !path.extname(specifier));
  const specifiers = [...new Set(mentioned?.startsWith('.') ? [mentioned, ...imports] : imports)];
  const matches = specifiers.flatMap(specifier => {
    const base = path.resolve(workspaceRoot, path.dirname(sourceFile), specifier);
    const files = ['.cjs', '.js', '.mjs', '.json'].map(ext => `${base}${ext}`).filter(file => fs.existsSync(file) && fs.statSync(file).isFile());
    return files.length === 1 ? [{ specifier, file: files[0] }] : [];
  });
  if (matches.length !== 1) return undefined;
  const { specifier, file } = matches[0];
  const resolved = path.relative(path.resolve(workspaceRoot, path.dirname(sourceFile)), file).replace(/\\/g, '/');
  const replacement = `${specifier}${path.extname(resolved)}`;
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const content = source.replace(new RegExp(`(['"])${escaped}\\1`, 'g'), `$1${replacement}$1`);
  return content === source ? undefined : { content, changed: true, resolved: replacement };
}
