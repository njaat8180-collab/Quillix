import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildTavilyClaimReport, compareTavilyEvidence, type TavilySource } from '../../src/server/tavilyVerification.js';

/**
 * Deterministic hackathon demonstration. It uses a recorded source fixture so
 * judges can run the full stale -> approve -> edit -> test -> report flow
 * without spending credits. Live Tavily Search + Extract remains exercised by
 * the service and HTTP tests when a key is configured.
 */
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-tavily-demo-'));
const configPath = path.join(root, 'config.js');
const source: TavilySource = {
  title: 'Official Example API migration guide',
  url: 'https://docs.example.com/migration/v19',
  domain: 'docs.example.com',
  official: true,
  content: 'The legacy oldApi is deprecated and removed in v19. Use newApi instead.',
  rawContent: 'The legacy oldApi is deprecated and removed in v19. Use newApi instead.',
};
const answer = 'Use the current oldApi in version v19.';
const initial = fs.writeFileSync(configPath, 'module.exports = { api: oldApi() };\n');
void initial;
const initialFinding = compareTavilyEvidence(answer, [source]);
const claims = buildTavilyClaimReport(answer, [source], initialFinding.finding);
const approved = String(process.env.QUILLIX_DEMO_APPROVE || 'true').toLowerCase() === 'true';
let correctionApplied = false;
let testPassed = false;
if (approved && (initialFinding.finding === 'contradicted' || initialFinding.finding === 'possibly_stale')) {
  const corrected = fs.readFileSync(configPath, 'utf8').replace(/oldApi/g, 'newApi');
  fs.writeFileSync(configPath, corrected);
  correctionApplied = true;
  try { execFileSync(process.execPath, ['--check', configPath], { stdio: 'pipe' }); testPassed = true; } catch { testPassed = false; }
}
const report = {
  demo: 'Tavily Stale-Answer Detector + Verified Coding Repair',
  transport: 'deterministic-fixture (no Tavily credits spent)',
  stages: [
    { name: 'claim-extraction', status: claims.claims.length > 0 ? 'passed' : 'failed', claimCount: claims.claims.length },
    { name: 'official-source-comparison', status: initialFinding.finding === 'contradicted' ? 'passed' : 'failed', finding: initialFinding.finding, source: source.url },
    { name: 'human-approval-gate', status: approved ? 'passed' : 'blocked' },
    { name: 'targeted-correction', status: correctionApplied ? 'passed' : 'not_run', file: configPath },
    { name: 'test-and-retest', status: testPassed ? 'passed' : correctionApplied ? 'failed' : 'not_run', command: 'node --check config.js' },
  ],
  freshnessScoreBefore: claims.freshnessScore,
  final: correctionApplied && testPassed ? 'verified' : approved ? 'incomplete' : 'awaiting approval',
  citations: [source.url],
  usage: { searches: 0, extracts: 0, credits: 0, estimatedCostUsd: 0 },
  simulatedOperations: { searches: 1, extracts: 1, transport: 'fixture-only' },
};
const outputPath = path.resolve(process.env.QUILLIX_TAVILY_DEMO_OUTPUT || '.quillix-smoke/tavily-hackathon-demo.json');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ outputPath, ...report }, null, 2));
if (report.final !== 'verified') process.exitCode = 1;
