import fs from 'node:fs';
import path from 'node:path';
import { buildTavilyClaimReport, compareTavilyEvidence, type TavilySource } from '../../src/server/tavilyVerification.js';

type Case = { name: string; answer: string; sources: TavilySource[]; expected: string };
const official = (content: string): TavilySource => ({ title: 'Official documentation', url: 'https://docs.example.com/current', domain: 'docs.example.com', content, official: true });
const cases: Case[] = [
  { name: 'unsupported-version', answer: 'Use version v18 current API.', sources: [official('The current API is supported in version v19.')], expected: 'possibly_stale' },
  { name: 'deprecated-claim', answer: 'The legacy API is current and supported.', sources: [official('The legacy API is deprecated and removed; use the replacement instead.')], expected: 'contradicted' },
  { name: 'supported-claim', answer: 'Use the current API.', sources: [official('The current API is supported and recommended.')], expected: 'supported' },
  { name: 'insufficient-evidence', answer: 'Use the current API.', sources: [], expected: 'unverified' },
];
const results = cases.map(testCase => {
  const actual = compareTavilyEvidence(testCase.answer, testCase.sources).finding;
  const claimReport = buildTavilyClaimReport(testCase.answer, testCase.sources, actual);
  return { name: testCase.name, expected: testCase.expected, actual, freshnessScore: claimReport.freshnessScore, claimCount: claimReport.claims.length, citedClaimCount: claimReport.claims.filter(claim => claim.sourceUrls.length > 0).length };
});
const passed = results.filter(result => result.expected === result.actual).length;
const confusionMatrix = results.reduce<Record<string, number>>((matrix, result) => {
  const key = `${result.expected}->${result.actual}`;
  matrix[key] = (matrix[key] || 0) + 1;
  return matrix;
}, {});
const report = { createdAt: new Date().toISOString(), sampleSize: cases.length, passed, passRate: passed / cases.length, accuracy: passed / cases.length, citationCoverage: results.reduce((sum, result) => sum + (result.claimCount ? result.citedClaimCount / result.claimCount : 0), 0) / cases.length, confusionMatrix, results };
const outputPath = path.resolve(process.env.QUILLIX_TAVILY_BENCHMARK_OUTPUT || '.quillix-smoke/tavily-verification-benchmark.json');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ outputPath, ...report }, null, 2));
if (passed !== cases.length) process.exitCode = 1;
