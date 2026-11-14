import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as wait} from 'node:timers/promises';

const [instanceId, output, offset = '0'] = process.argv.slice(2);
if (!instanceId || !/^[a-zA-Z0-9_.-]+__[a-zA-Z0-9_.-]+-\d+$/.test(instanceId) || !output || !/^\d+$/.test(offset)) {
  throw new Error('Usage: node scripts/smoke/import-swebench-task.mjs <instance-id> <output.json> [repository-row-offset]');
}
const dataset = 'SWE-bench/SWE-bench_Multilingual';
const url = new URL('https://datasets-server.huggingface.co/filter');
const [, owner, project] = instanceId.match(/^(.+)__(.+)-\d+$/);
url.search = new URLSearchParams({dataset, config: 'default', split: 'test', where: `"repo"='${owner}/${project}'`, length: '1',
  ...(offset === '0' ? {} : {offset})}).toString();
let response;
for (let attempt = 0; attempt < 3; attempt++) {
  response = await fetch(url, {signal: AbortSignal.timeout(30000)});
  if (response.ok || (response.status !== 429 && response.status < 500) || attempt === 2) break;
  await response.body?.cancel();
  await wait(1000 * 2 ** attempt);
}
if (!response.ok) throw new Error(`Dataset service returned HTTP ${response.status}`);
const data = await response.json();
const entry = data.rows?.find(item => item.row?.instance_id === instanceId);
const row = entry?.row;
if (row?.instance_id !== instanceId || !/^[a-f0-9]{40}$/.test(row.base_commit) ||
    !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(row.repo) || typeof row.problem_statement !== 'string' || !row.problem_statement.trim()) {
  throw new Error('The dataset did not return a valid matching task');
}
if (entry.truncated_cells?.includes('problem_statement')) throw new Error('The service truncated the task instruction');
// Whitelist only inference inputs. Reference answers and grader patches must
// stay outside the agent workspace and are never included in this artifact.
const task = {
  instance_id: row.instance_id, repo: row.repo, base_commit: row.base_commit, problem_statement: row.problem_statement,
  source: {dataset, url: url.toString(), fetchedAt: new Date().toISOString(), revision: response.headers.get('x-revision')},
};
const serialized = JSON.stringify(task, null, 2) + '\n';
const target = path.resolve(output);
fs.mkdirSync(path.dirname(target), {recursive: true});
fs.writeFileSync(target, serialized, {flag: 'wx'});
console.log(JSON.stringify({instanceId, repo: row.repo, baseCommit: row.base_commit,
  output: target, sha256: createHash('sha256').update(serialized).digest('hex'), status: 'IMPORTED'}));
