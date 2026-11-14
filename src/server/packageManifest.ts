/**
 * Shared `package.json` reader with an mtime-validated cache.
 *
 * Why this exists
 * ---------------
 * The agent engine, tool registry, indexer, language-runner detector and the
 * auto-test runner each parsed `<root>/package.json` with their own inline
 * `JSON.parse(fs.readFileSync(...))`. That duplicated implementation meant:
 *
 *  1. Every call re-read the file from disk and re-parsed the JSON, even
 *     when the same manifest was inspected several times within one agent
 *     turn (test command lookup, build lookup, lint lookup, verification
 *     command resolution).
 *  2. The parse failures were handled differently at every site, so a
 *     malformed manifest surfaced as different behaviour depending on which
 *     code path happened to read it first.
 *
 * This module centralises the read and keeps the previous semantics exactly:
 * a missing or invalid manifest resolves to `undefined` and never throws.
 *
 * Cache invalidation
 * ------------------
 * Entries are validated against the file's `mtimeMs` and `size` on every
 * hit, so an edited `package.json` is picked up immediately (this is a
 * development tool — stale build scripts are worse than a tiny stat call).
 * The cache is bounded by entry count so a session that walks many
 * workspaces cannot grow it without limit.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface PackageManifest {
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

interface CacheEntry {
  manifest: PackageManifest | undefined;
  mtimeMs: number;
  size: number;
}

/** Maximum number of distinct manifests kept in memory at once. */
const MAX_CACHE_ENTRIES = 64;

const cache = new Map<string, CacheEntry>();

/** Test seam: drop all cached manifests (used by tests and after writes). */
export function clearPackageManifestCache(): void {
  cache.clear();
}

/**
 * Read and parse `<root>/package.json`.
 *
 * Returns `undefined` when the manifest is missing, unreadable or invalid —
 * matching the previous per-call-site behaviour.
 */
export function readPackageManifest(root: string): PackageManifest | undefined {
  if (!root) return undefined;
  const manifestPath = path.join(root, 'package.json');
  let stat: fs.Stats;
  try {
    stat = fs.statSync(manifestPath);
  } catch {
    // Missing (or unreadable) manifest: drop any stale entry and report
    // "no manifest" the same way the old inline try/catch did.
    cache.delete(manifestPath);
    return undefined;
  }
  if (!stat.isFile()) {
    cache.delete(manifestPath);
    return undefined;
  }

  const cached = cache.get(manifestPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    // Refresh LRU position.
    cache.delete(manifestPath);
    cache.set(manifestPath, cached);
    return cached.manifest;
  }

  let manifest: PackageManifest | undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest = parsed && typeof parsed === 'object' ? (parsed as PackageManifest) : undefined;
  } catch {
    manifest = undefined;
  }

  cache.delete(manifestPath);
  cache.set(manifestPath, { manifest, mtimeMs: stat.mtimeMs, size: stat.size });
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
  return manifest;
}

/** Convenience helper: the `scripts` map of `<root>/package.json`. */
export function readPackageScripts(root: string): Record<string, string> {
  const manifest = readPackageManifest(root);
  const scripts = manifest?.scripts;
  return scripts && typeof scripts === 'object' ? scripts : {};
}

/** Convenience helper: the `test` script of `<root>/package.json` (or ''). */
export function readPackageTestScript(root: string): string {
  const script = readPackageScripts(root).test;
  return typeof script === 'string' ? script : '';
}
