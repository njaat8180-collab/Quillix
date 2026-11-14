import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceManager } from '../workspace.js';
import { TypeScriptLanguageService } from '../typescriptLanguageService.js';

describe('bounded TypeScript language service', () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

  it('resolves project-local definitions and references instead of only matching text', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-ts-service-')); roots.push(root);
    fs.writeFileSync(path.join(root, 'util.ts'), 'export function add(a: number, b: number) { return a + b; }\n');
    fs.writeFileSync(path.join(root, 'app.ts'), 'import { add } from "./util.js";\nexport const total = add(2, 3);\n');
    const service = new TypeScriptLanguageService(new WorkspaceManager(root));
    const definitions = service.findDefinitions('add');
    expect(definitions.some(item => item.filePath === 'util.ts' && item.line === 1)).toBe(true);
    const references = service.findReferences('add');
    expect(references.some(item => item.filePath === 'app.ts')).toBe(true);
  });

  it('returns bounded semantic diagnostics without reading outside the workspace', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-ts-diagnostics-')); roots.push(root);
    fs.writeFileSync(path.join(root, 'broken.ts'), 'const value: number = "wrong";\n');
    const service = new TypeScriptLanguageService(new WorkspaceManager(root));
    const diagnostics = service.diagnostics('broken.ts');
    expect(diagnostics.some(item => item.filePath === 'broken.ts' && item.category === 'error')).toBe(true);
    expect(service.diagnostics('../outside.ts')).toEqual([]);
  });
});
