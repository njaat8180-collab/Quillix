import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('public score report is explicitly reference-only and rejects missing provenance', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-public-ref-'));
  try {
    const q = path.join(dir, 'q.json'), r = path.join(dir, 'r.json');
    fs.writeFileSync(q, JSON.stringify({model:'local:1b', protocol:'q-v1', aggregate:{total:6, passRatePercent:50}}));
    fs.writeFileSync(r, JSON.stringify({benchmark:'SWE-bench Verified',system:'Example scaffold',publishedAt:'2026-11-01',sourceUrl:'https://example.com/result',scorePercent:40}));
    const script = path.resolve('scripts/smoke/report-public-benchmark.mjs');
    const good = spawnSync(process.execPath, [script, q, r], {encoding:'utf8'});
    assert.equal(good.status, 0, good.stderr);
    const report = JSON.parse(good.stdout);
    assert.equal(report.status, 'REFERENCE_ONLY');
    assert.equal('deltaPercentagePoints' in report, false);
    assert.match(report.comparison, /Not computed/);
    assert.match(report.warning, /not a controlled head-to-head/i);
    fs.writeFileSync(r, JSON.stringify({benchmark:'SWE-bench',system:'x',publishedAt:'today',scorePercent:40}));
    const bad = spawnSync(process.execPath, [script, q, r], {encoding:'utf8'});
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /sourceUrl/);
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});
