import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

describe('lazy-loading contracts', () => {
  it('the TypeScript language service does not eagerly import the Monaco runtime', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'src/server/typescriptLanguageService.ts'), 'utf8');
    // The runtime import must be type-only; the value import must be inside
    // the lazy loader function, not at module top level.
    expect(source).toMatch(/import type \* as TsNamespace/);
    const topLevelValueImport = source.match(/^import\s+\{?\s*typescript\s+as\s+ts\s*\}?\s+from/m);
    expect(topLevelValueImport).toBeNull();
    expect(source).toMatch(/require\('monaco-editor\/languages\/features\/typescript\/lib\/typescriptServices\.js'\)/);
  });

  it('the renderer lazy-loads its heavy overlays', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'src/App.tsx'), 'utf8');
    expect(source).toMatch(/lazy\(\(\) => import\('\.\/components\/SettingsScreen\.js'\)/);
    expect(source).toMatch(/lazy\(\(\) => import\('\.\/components\/OnboardingFlow\.js'\)/);
    expect(source).toMatch(/lazy\(\(\) => import\('\.\/components\/CommandPalette\.js'\)/);
    expect(source).toMatch(/<Suspense/);
  });

  it('the command palette state lives in a separate module so the UI can be code-split', () => {
    const appSource = fs.readFileSync(path.join(repoRoot, 'src/App.tsx'), 'utf8');
    // App.tsx must import the provider/hook from the state module, not from the
    // UI module — otherwise the dynamic import is ineffective.
    expect(appSource).toMatch(/from '\.\/components\/CommandPaletteState\.js'/);
    const stateSource = fs.readFileSync(path.join(repoRoot, 'src/components/CommandPaletteState.tsx'), 'utf8');
    expect(stateSource).toMatch(/export function CommandPaletteProvider/);
    expect(stateSource).toMatch(/export function useCommandPalette\(/);
  });

  it('the server uses the shared package-manifest reader instead of inline reads', () => {
    const offenders: string[] = [];
    const serverDir = path.join(repoRoot, 'src/server');
    for (const file of fs.readdirSync(serverDir)) {
      if (!file.endsWith('.ts') || file === 'packageManifest.ts') continue;
      const source = fs.readFileSync(path.join(serverDir, file), 'utf8');
      if (/JSON\.parse\(fs\.readFileSync\(path\.join\([^)]*'package\.json'/s.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
