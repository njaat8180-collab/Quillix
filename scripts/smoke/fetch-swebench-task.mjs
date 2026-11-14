// Fetches a single SWE-bench Lite task manifest from the public Hugging Face
// Dataset Viewer search endpoint and writes a minimal manifest for
// run-swebench-task.ts. Only built-in Node modules and fetch are used.
// The /search endpoint returns full matching row fields, so solution fields
// such as patch/test_patch/etc. may be present transiently in the API payload,
// but they are never written to disk: the endpoint row is filtered down to the
// manifest fields only.

import fs from 'node:fs';

const DATASET = 'SWE-bench/SWE-bench_Lite';
const DATASET_URL = `https://huggingface.co/datasets/${DATASET}`;
const SEARCH_URL = 'https://datasets-server.huggingface.co/search';
const NETWORK_TIMEOUT_MS = 20_000;

const fail = (message) => {
  console.error(`fetch-swebench-task: ${message}`);
  process.exit(2);
};

const args = process.argv.slice(2);
if (args.length !== 2) {
  fail('usage: node scripts/smoke/fetch-swebench-task.mjs <instance_id> <output.json>');
}
const [instanceId, outputPath] = args;
if (!/^[A-Za-z0-9_.-]+__[A-Za-z0-9_.-]+-\d+$/.test(instanceId)) {
  fail(`invalid instance_id: ${instanceId}`);
}

const repoSlugRe = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const commitRe = /^[a-f0-9]{40}$/;

const url = new URL(SEARCH_URL);
url.searchParams.set('dataset', DATASET);
url.searchParams.set('config', 'default');
url.searchParams.set('split', 'test');
url.searchParams.set('query', instanceId);
url.searchParams.set('offset', '0');
url.searchParams.set('length', '100');

let response;
try {
  response = await fetch(url, {signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS)});
} catch (cause) {
  fail(`network request failed: ${cause?.message || cause}`);
}
if (!response.ok) {
  fail(`dataset search endpoint returned ${response.status} ${response.statusText}`);
}

let payload;
try {
  payload = await response.json();
} catch (cause) {
  fail(`endpoint response was not valid JSON: ${cause?.message || cause}`);
}

const rows = Array.isArray(payload?.rows) ? payload.rows : [];
const match = rows.find((row) => row?.row?.instance_id === instanceId);
if (!match) {
  fail(`instance_id ${instanceId} was not found in dataset ${DATASET} (exact id match required)`);
}

const row = match.row;
const repo = typeof row.repo === 'string' ? row.repo : '';
const baseCommit = typeof row.base_commit === 'string' ? row.base_commit : '';
const problemStatement = typeof row.problem_statement === 'string' ? row.problem_statement : '';

if (!repoSlugRe.test(repo)) fail(`invalid repo slug: ${repo}`);
if (!commitRe.test(baseCommit)) fail(`invalid base_commit: ${baseCommit}`);
if (!problemStatement.trim()) fail('problem_statement is empty');

const manifest = {
  instance_id: instanceId,
  repo,
  base_commit: baseCommit,
  problem_statement: problemStatement,
  source: DATASET_URL,
  dataset: DATASET,
};

if (typeof row.native_check_command === 'string' && row.native_check_command.trim()) {
  manifest.native_check_command = row.native_check_command.trim();
}

let written;
try {
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'});
  written = true;
} catch (cause) {
  if (cause?.code === 'EEXIST') fail(`output file already exists: ${outputPath}`);
  throw cause;
}
if (!written) fail(`could not write output file: ${outputPath}`);

console.log(JSON.stringify({
  instance_id: manifest.instance_id,
  repo: manifest.repo,
  base_commit: manifest.base_commit,
  problem_statement_chars: manifest.problem_statement.length,
  source: manifest.source,
  output: outputPath,
}));