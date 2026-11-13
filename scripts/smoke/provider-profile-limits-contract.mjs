import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// M6.5 regression contract: saved provider profiles must be editable in the UI
// (min request spacing, max input chars, max output tokens, prices) and the
// edit must ride the existing validated settings contract. Pre-fix code only
// set the budget at creation time, so saved providers could never be tuned.
const project = path.resolve(import.meta.dirname, '../..');
const profiles = fs.readFileSync(path.join(project, 'src/components/ProviderProfiles.tsx'), 'utf8');

const checks = [
  ['the limits editor is gated on a selected saved provider',
    /const activeProfile=\(settings\.providerProfiles\|\|\[\]\)\.find\(p=>p\.id===settings\.activeProviderProfile\)\|\|null;/],
  ['saved-profile budget fields are hydrated into editor state',
    /setEditMaxInputChars\(profile\?\.requestBudget\?\.maxInputChars!=null\?String\(profile\.requestBudget\.maxInputChars\):''\)/],
  ['min request spacing is editable for saved providers',
    /aria-label="Minimum provider request spacing"[\s\S]*?value=\{editMinIntervalMs\}[\s\S]*?onChange=\{e=>setEditMinIntervalMs\(e\.target\.value\)\}/],
  ['max input characters is editable for saved providers',
    /aria-label="Maximum provider input characters"[\s\S]*?value=\{editMaxInputChars\}[\s\S]*?onChange=\{e=>setEditMaxInputChars\(e\.target\.value\)\}/],
  ['max output tokens is editable for saved providers',
    /aria-label="Maximum provider output tokens"[\s\S]*?value=\{editMaxOutputTokens\}[\s\S]*?onChange=\{e=>setEditMaxOutputTokens\(e\.target\.value\)\}/],
  ['input price per million tokens is editable',
    /aria-label="Provider input price per million tokens"[\s\S]*?value=\{editInputPrice\}/],
  ['output price per million tokens is editable',
    /aria-label="Provider output price per million tokens"[\s\S]*?value=\{editOutputPrice\}/],
  ['blank fields mean provider-documented defaults, not stale overrides',
    /if\(Object\.keys\(budget\)\.length\)updated\.requestBudget=budget;\s*\n\s*else delete updated\.requestBudget;/],
  ['the edit persists through the validated settings contract (profiles array)',
    /const r=await api\.updateSettings\(\{providerProfiles:profiles,activeProviderProfile:id,aiProvider:'universal'\}\)/],
  ['non-negative finite numbers are validated before saving',
    /if\(value!==undefined&&\(!Number\.isFinite\(value\)\|\|value<0\)\)/],
  ['effective pacing is shown from the shared pacing policy',
    /getEffectiveProviderIntervalMs\(settings\)/],
];

for (const [name, pattern] of checks) assert.match(profiles, pattern, name);
console.log(JSON.stringify({ status: 'PASS', file: 'src/components/ProviderProfiles.tsx', checks: checks.length }));
