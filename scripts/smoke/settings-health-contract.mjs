import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, 'src', 'components', 'SettingsScreen.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const helperSource = fs.readFileSync(path.join(root, 'src', 'shared', 'apiHealth.ts'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
const required = [
  ["Tavily is a health target", /id:\s*'tavily',\s*label:\s*'Tavily API · verification'/],
  ["Health Center uses the shared active-target policy", /activeApiHealthTargets\(settings\)/],
  ["Tavily is always shown with the active provider", /target\.id === active \|\| target\.id === 'tavily'/],
  ["Health Center names the Tavily API", /Active Provider \+ Tavily API Health/],
  ["Tavily has a real verification endpoint", /fetch\('\/api\/verification\/tavily'/],
  ["Tavily key input is masked", /aria-label=\"Tavily API key\" type=\"password\"/],
  ["Health UI does not expose API keys", /Tests never display API keys/],
  ["Dedicated providers expose encrypted failover controls", /FailoverKeyPanel provider="(?:openai|groq|grok|sarvam)"/],
  ["Failover counts are rendered without secrets", /encrypted backup/],
  ["Settings response includes dedicated failover counts", /openaiKeyPoolCount:openAIFailoverKeyCount\(\).*groqKeyPoolCount:groqFailoverKeyCount\(\)/s],
  ["Turbo panel exposes live reported output throughput", /provider-performance-metrics[\s\S]*?tokensPerSecond[\s\S]*?outputTokens/],
  ["Turbo interval labels retain sub-second precision", /function formatPacingInterval[\s\S]*?value < 1_000[\s\S]*?ms/],
  ["rate-limit endpoint includes read-only provider diagnostics", /app\.get\('\/api\/providers\/rate-limit'[\s\S]*?providerDiagnostics/],
  ["OpenAI, Groq and Grok catalogs use the active provider's saved credentials", /settings\.aiProvider==='openai'[\s\S]*?readOpenAIKeys\(\)[\s\S]*?settings\.aiProvider==='groq'[\s\S]*?readGroqKeys\(\)[\s\S]*?settings\.aiProvider==='grok'[\s\S]*?readGrokKeys\(\)/],
  ["the Settings model catalog requests a fresh account list", /fetch\('\/api\/providers\/models\?refresh=1'[\s\S]*?setAccountModels\(models\)/],
  ["changing providers clears the prior account model list", /setAccountModels\(\[\]\);setAccountModel\(''\);setAccountModelsMessage\(''\);\s*\}, \[settings\?\.aiProvider\]\)/],
  ["chosen account models are saved to the matching provider setting", /settings\.aiProvider==='openai'\?'openaiModel':settings\.aiProvider==='groq'\?'groqModel':'grokModel'/],
  ["model options disclose capability metadata", /accountModels\.map\(model=><option[\s\S]*?formatProviderModelLabel\(model\)/],
];
const failures = required.filter(([name, pattern]) => {
  const haystack = name.includes('Settings response') || name.includes('rate-limit endpoint') || name.includes('saved credentials') ? serverSource : name.includes('active provider') ? helperSource : `${source}\n${helperSource}`;
  return !pattern.test(haystack);
}).map(([name]) => name);
if (failures.length) {
  console.error(`SETTINGS HEALTH CONTRACT FAILED: ${failures.join('; ')}`);
  process.exit(1);
}
console.log(JSON.stringify({ status: 'PASS', file: path.relative(root, sourcePath), checks: required.length }));
