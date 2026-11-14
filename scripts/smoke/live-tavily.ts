import { hasTavilyKey, TavilyVerificationService } from '../../src/server/tavilyVerification.js';

/** Optional live smoke. It never fails a normal offline/CI run for missing credentials. */
if (!hasTavilyKey()) {
  console.log(JSON.stringify({ status: 'SKIP', reason: 'No Tavily key in DPAPI secure storage or TAVILY_API_KEY.' }));
  process.exit(0);
}

const service = new TavilyVerificationService();
const result = await service.verify({
  query: 'official Tavily JavaScript SDK Search Extract documentation',
  answer: 'The official Tavily JavaScript SDK supports Search and Extract.',
  force: process.env.QUILLIX_TAVILY_FORCE === 'true',
  offline: false,
});
const output = {
  status: 'PASS',
  finding: result.finding,
  freshnessScore: result.freshnessScore,
  claimCount: result.claims.length,
  sources: result.sources.slice(0, 5).map(source => ({ title: source.title, url: source.url, official: source.official })),
  usage: result.usage,
  searchedAt: result.searchedAt,
  cached: result.cached,
};
console.log(JSON.stringify(output, null, 2));
if (!result.sources.length || !result.searchedAt || result.usage.searches < 1) process.exitCode = 1;
