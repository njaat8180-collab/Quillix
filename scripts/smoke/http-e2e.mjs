/** Real HTTP acceptance: server + mock Ollama + filesystem, on Windows/Linux. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-http-e2e-'));
const workspace = path.join(base, 'workspace');
fs.mkdirSync(workspace);
fs.mkdirSync(path.join(workspace, '.quillix'), { recursive: true });
fs.writeFileSync(path.join(workspace, '.quillix', 'memory.json'), JSON.stringify({
  projects: [{ name: 'memory-trigger-project', root: workspace }],
}));
const processes = [];
const logs = [];
const obtainPort = () => new Promise((resolve, reject) => {
  const socket = net.createServer();
  socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => {
    const port = socket.address().port;
    socket.close(() => resolve(port));
  });
});
const assertData = async (response) => {
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return body;
};
const streamEvents = async (response) => {
  const body = await response.text();
  return body.split('\n\n').map(p => p.startsWith('data: ') ? p.slice(6) : null)
    .filter(Boolean).map(p => { try { return JSON.parse(p); } catch { return null; } }).filter(Boolean);
};
const ready = async (url) => {
  for (let i = 0; i < 65; i++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1200) })).ok) return; } catch {}
    await delay(200);
  }
  throw new Error(`Service did not start: ${url}`);
};
function start(name, script, env = {}) {
  const child = spawn(process.execPath, [script], { cwd: projectRoot, shell: false,
    env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  processes.push(child);
  for (const output of [child.stdout, child.stderr]) output?.on('data', b => {
    logs.push(`${name}: ${b.toString('utf8')}`);
  });
  child.on('error', e => logs.push(`${name}: ${e.message}`));
}

try {
  const apiPort = await obtainPort();
  const mockPort = await obtainPort();
  const universalPort = await obtainPort();
  const textOnlyUniversalPort = await obtainPort();
  const url = `http://127.0.0.1:${apiPort}`;
  start('ollama', 'scripts/e2e/mock-ollama.cjs', { QUILLIX_MOCK_OLLAMA_PORT: String(mockPort) });
  start('universal', 'scripts/e2e/mock-universal.cjs', { QUILLIX_MOCK_UNIVERSAL_PORT: String(universalPort) });
  start('universal-text-only', 'scripts/e2e/mock-universal.cjs', {
    QUILLIX_MOCK_UNIVERSAL_PORT: String(textOnlyUniversalPort),
    QUILLIX_MOCK_UNIVERSAL_TEXT_ONLY: '1',
  });
  await ready(`http://127.0.0.1:${mockPort}/api/tags`);
  await ready(`http://127.0.0.1:${universalPort}/health`);
  await ready(`http://127.0.0.1:${textOnlyUniversalPort}/health`);
  start('server', 'scripts/smoke/launchBackend.mjs', {
    NODE_ENV: 'production', PORT: String(apiPort),
    QUILLIX_SETTINGS_PATH: path.join(base, 'settings.json'),
  });
  const api = (route, method = 'GET', data, extraHeaders = {}) => fetch(url + route, {
    method, headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders },
    ...(data === undefined ? {} : { body: JSON.stringify(['/api/tools/execute', '/api/agent/run'].includes(route) ? data : { conversationMode: 'agent', ...data }) }),
    signal: AbortSignal.timeout(55000),
  });
  await ready(url + '/api/health');
  console.log('PASS - real HTTP server startup');

  await assertData(await api('/api/settings', 'PUT', {
    model: 'qwen2.5-coder:3b', ollamaBaseUrl: `http://127.0.0.1:${mockPort}`,
    autoApplyDiffs: true, terminalApproval: true, maxAutonomousTurns: 12,
  }));
  const brainCatalog = await assertData(await api('/api/brains'));
  assert.equal(brainCatalog.active, 'ollama');
  assert.deepEqual(brainCatalog.brains.map(brain => brain.id), ['ollama', 'sarvam', 'openai', 'grok', 'groq', 'nvidia', 'universal']);
  assert.equal(Object.hasOwn(brainCatalog.brains[0], 'create'), false);
  console.log('PASS - provider-agnostic brain catalog and capability boundary');
  const offlineVerification = await assertData(await api('/api/verification/tavily', 'POST', {
    query: 'What is the current API?', answer: 'This is an offline safety check.',
  }));
  assert.equal(offlineVerification.result.finding, 'offline');
  assert.equal(offlineVerification.result.offlineFallback, true);
  const tavilyHistory = await assertData(await api('/api/verification/tavily/history'));
  assert.ok(Array.isArray(tavilyHistory.history), 'Tavily history must be an array');
  console.log('PASS - Tavily verification fails closed in Offline Mode');
  const removableProfile = {
    id: 'remove-profile-test', name: 'Removal test provider', protocol: 'openai',
    endpoint: 'https://provider.example/v1', model: 'test-model',
    auth: { type: 'none' }, capabilities: { tools: true, streaming: true, reasoning: false },
  };
  await assertData(await api('/api/settings', 'PUT', {
    providerProfiles: [removableProfile], activeProviderProfile: removableProfile.id,
    aiProvider: 'universal', offlineMode: false,
  }));
  await assertData(await api('/api/providers/universal/key', 'DELETE', { profileId: removableProfile.id }));
  const afterProfileCredentialDelete = await assertData(await api('/api/settings'));
  assert.equal(afterProfileCredentialDelete.settings.providerProfiles.some(profile => profile.id === removableProfile.id), true,
    'Deleting a profile credential must not delete the saved profile itself.');
  console.log('PASS - provider profile credential removal remains endpoint-scoped');
  const probeProfile = {
    id: 'tool-probe-test', name: 'Tool probe test provider', protocol: 'openai',
    endpoint: `http://127.0.0.1:${universalPort}/v1`, model: 'quillix-probe',
    auth: { type: 'none' }, capabilities: { tools: true, streaming: false, reasoning: false },
  };
  await assertData(await api('/api/settings', 'PUT', {
    providerProfiles: [probeProfile], activeProviderProfile: probeProfile.id,
    aiProvider: 'universal', offlineMode: false,
  }));
  const probeResult = await assertData(await api('/api/providers/universal/test', 'POST'));
  assert.equal(probeResult.capabilities.tools, true, 'Connection test must verify the declared native tool contract');
  console.log('PASS - Universal connection test verifies native tool capability');
  const textOnlyProfile = { ...probeProfile, id: 'text-only-probe-test', endpoint: `http://127.0.0.1:${textOnlyUniversalPort}/v1` };
  await assertData(await api('/api/settings', 'PUT', {
    providerProfiles: [textOnlyProfile], activeProviderProfile: textOnlyProfile.id,
    aiProvider: 'universal', offlineMode: false,
  }));
  const textOnlyProbe = await api('/api/providers/universal/test', 'POST');
  const textOnlyBody = await textOnlyProbe.json();
  assert.equal(textOnlyProbe.status, 502);
  assert.equal(textOnlyBody.status, 'text_connected_tools_unverified');
  assert.match(textOnlyBody.error, /native tool call|required for coding/i);
  console.log('PASS - text-only Universal provider is not falsely marked tool-capable');
  await assertData(await api('/api/settings', 'PUT', { providerProfiles: [], activeProviderProfile: '', aiProvider: 'ollama' }));
  const status = await assertData(await api('/api/ollama/status'));
  assert.equal(status.status.modelAvailable, true);
  console.log('PASS - mock Ollama transport and model handshake');

  await assertData(await api('/api/workspace/set-root', 'POST', { targetPath: workspace }));
  assert.equal((await assertData(await api('/api/workspace/root'))).path, workspace);
  const missingMode = await api('/api/agent/run', 'POST', {
    userPrompt: 'Create missing-mode.html in this workspace.', mode: 'agent', conversationHistory: [],
  });
  assert.equal(missingMode.status, 400, 'The server must reject ambiguous requests without an explicit Chat/Agent lock.');
  assert.equal(fs.existsSync(path.join(workspace, 'missing-mode.html')), false);
  console.log('PASS - server requires an explicit Chat/Agent mode before routing');
  // The renderer is not the only safety boundary: an explicit Chat-mode
  // request must remain read-only even when the prompt looks actionable and
  // the requested mode field says "agent".
  const chatLocked = await api('/api/agent/run', 'POST', {
    userPrompt: 'Create test.html in the memory-trigger-project project.',
    mode: 'agent', conversationMode: 'chat', conversationHistory: [],
  });
  const chatLockedEvents = await streamEvents(chatLocked);
  const chatLockedDone = chatLockedEvents.find(e => e.event === 'done');
  assert.equal(chatLocked.status, 200);
  assert.ok(chatLockedDone, `Chat-mode request did not complete: ${JSON.stringify(chatLockedEvents.slice(-2))}`);
  assert.equal(chatLockedDone.result?.patches?.length || 0, 0, 'Chat mode must not create file patches');
  assert.equal(fs.existsSync(path.join(workspace, 'test.html')), false, 'Chat mode must not write workspace files');
  console.log('PASS - server-side Chat mode lock blocks mutations');

  const directToolChat = await api('/api/tools/execute', 'POST', {
    name: 'write_file', args: { filePath: 'manual-chat-blocked.txt', content: 'must stay blocked' }, conversationMode: 'chat',
  });
  assert.equal(directToolChat.status, 409, 'Manual mutation tools must honor the explicit Chat mode lock.');
  assert.equal(fs.existsSync(path.join(workspace, 'manual-chat-blocked.txt')), false);
  const directToolNoMode = await api('/api/tools/execute', 'POST', {
    name: 'write_file', args: { filePath: 'manual-mode-missing.txt', content: 'must stay blocked' },
  });
  assert.equal(directToolNoMode.status, 400, 'Manual mutation tools must fail closed when the mode is missing.');
  const directToolAgent = await api('/api/tools/execute', 'POST', {
    name: 'write_file', args: { filePath: 'manual-agent-allowed.txt', content: 'agent mode write' }, conversationMode: 'agent',
  });
  assert.equal((await assertData(directToolAgent)).success, true);
  assert.equal(fs.readFileSync(path.join(workspace, 'manual-agent-allowed.txt'), 'utf8'), 'agent mode write');
  console.log('PASS - manual workspace tools enforce the Chat/Agent mode lock server-side');

  const manualMutationRoutes = [
    ['/api/workspace/file', 'POST', { filePath: 'direct-chat-file.txt', content: 'blocked' }],
    ['/api/workspace/file', 'DELETE', { filePath: 'manual-agent-allowed.txt' }],
    ['/api/workspace/rename', 'POST', { oldPath: 'manual-agent-allowed.txt', newPath: 'renamed.txt' }],
    ['/api/workspace/create-project', 'POST', { parentPath: workspace, projectName: 'blocked-project' }],
    ['/api/terminal/run', 'POST', { command: 'node -e "process.exit(7)"' }],
    ['/api/project/run', 'POST', { root: workspace }],
    ['/api/preview/start', 'POST', { root: workspace, entry: 'index.html' }],
    ['/api/git/stage', 'POST', { filePath: '.' }],
    ['/api/git/commit', 'POST', { message: 'blocked' }],
    ['/api/git/restore', 'POST', { filePath: 'manual-agent-allowed.txt' }],
    ['/api/agent/approve', 'POST', { approvalId: 'missing-approval', approved: true }],
    ['/api/tasks/missing-task/rollback', 'POST', {}],
    ['/api/extensions/coding/quillix-formatter', 'PUT', { enabled: false }],
  ];
  for (const [route, method, data] of manualMutationRoutes) {
    const blocked = await api(route, method, { ...data, conversationMode: 'chat' });
    assert.equal(blocked.status, 409, `${method} ${route} must reject Chat mode before any mutation.`);
  }
  const missingMutationMode = await api('/api/workspace/file', 'POST', {
    filePath: 'missing-mode-file.txt', content: 'blocked', conversationMode: undefined,
  });
  assert.equal(missingMutationMode.status, 400, 'Manual mutation endpoints must fail closed when mode is missing.');
  assert.equal(fs.existsSync(path.join(workspace, 'direct-chat-file.txt')), false);
  assert.equal(fs.existsSync(path.join(workspace, 'renamed.txt')), false);
  assert.equal(fs.existsSync(path.join(workspace, 'blocked-project')), false);
  assert.equal(fs.readFileSync(path.join(workspace, 'manual-agent-allowed.txt'), 'utf8'), 'agent mode write');
  console.log('PASS - all manual workspace mutation routes reject Chat and missing modes');

  for (const request of [
    { userPrompt: 'How do I fix the memory-trigger-project project?', mode: 'ask', conversationMode: 'agent' },
    { userPrompt: 'Fix the memory-trigger-project project.', mode: 'plan', conversationMode: 'chat' },
  ]) {
    const response = await api('/api/agent/run', 'POST', { ...request, conversationHistory: [] });
    const events = await streamEvents(response);
    assert.equal(events.find(event => event.event === 'intent')?.intent, 'chat', request.userPrompt);
    const result = events.find(event => event.event === 'done')?.result;
    assert.ok(result, `Read-only request did not complete: ${request.userPrompt}`);
    assert.deepEqual(result.toolCalls, []);
    assert.deepEqual(result.patches, []);
  }
  console.log('PASS - remembered projects respect ordinary questions and explicit Plan requests');

  const conciseAgentFollowUp = await api('/api/agent/run', 'POST', {
    userPrompt: 'Create test.html in this workspace.',
    mode: 'ask', conversationMode: 'agent', currentFile: 'style.css', conversationHistory: [],
  });
  const conciseAgentEvents = await streamEvents(conciseAgentFollowUp);
  const conciseAgentDone = conciseAgentEvents.find(event => event.event === 'done');
  assert.equal(conciseAgentEvents.find(event => event.event === 'intent')?.intent, 'agent',
    'A task in explicit Agent mode must not be demoted by a stale Ask workflow tab.');
  assert.ok(conciseAgentDone, 'The concise request must complete through the agent tool workflow.');
  assert.equal(fs.existsSync(path.join(workspace, 'test.html')), true,
    'The agent workflow must write the requested file to the workspace.');
  console.log('PASS - explicit Agent mode promotes actionable Ask-tab request into real file write');

  await assertData(await api('/api/workspace/file', 'POST', {
    filePath: 'style.css', content: '.panel { width: 900px; margin: 80px auto; }\n', isNew: true,
  }));
  const selectedFileEdit = await api('/api/agent/run', 'POST', {
    // Deliberately omit an action verb: the renderer's shared write-intent
    // guard recognizes this selected-file shorthand, and the server router
    // must preserve that decision instead of demoting the turn to Chat.
    userPrompt: 'mobile friendly',
    mode: 'ask', conversationMode: 'agent', currentFile: 'style.css', conversationHistory: [],
  });
  const selectedFileEvents = await streamEvents(selectedFileEdit);
  const selectedFileDone = selectedFileEvents.find(event => event.event === 'done');
  assert.equal(selectedFileEvents.find(event => event.event === 'intent')?.intent, 'agent');
  assert.ok(selectedFileDone, 'The selected-file follow-up must complete through the agent workflow.');
  assert.equal(fs.readFileSync(path.join(workspace, 'style.css'), 'utf8').includes('@media (max-width: 600px)'), true,
    'The follow-up must update the selected stylesheet on disk.');
  assert.ok(selectedFileDone.result?.verifiedFiles?.includes('style.css'), 'The changed file must appear in verification evidence.');
  assert.doesNotMatch(selectedFileDone.result?.finalText || '', /\.panel\s*\{|@media\s*\(/,
    'Implementation source must stay in workspace files instead of the chat response.');
  console.log('PASS - terse selected-file shorthand edits the open CSS file without dumping code into Chat');

  const outside = await api('/api/workspace/file?path=..%2F..%2Fetc%2Fpasswd');
  assert.equal((await outside.json()).success, false);
  const spoof = await api('/api/workspace/root', 'GET', undefined, { Origin: 'null' });
  assert.equal(spoof.status, 403);
  console.log('PASS - workspace traversal and sandboxed-origin restrictions');

  await assertData(await api('/api/workspace/file', 'POST', { filePath: 'index.html', content: '<!doctype html><title>Safe preview</title>', isNew: true }));
  await assertData(await api('/api/workspace/file', 'POST', { filePath: 'app.js', content: 'console.log("hello");', isNew: true }));
  // M2.5: optimistic-concurrency save conflict (unsaved buffer vs. disk).
  const conflictProbe = 'm25-conflict-probe.txt';
  await assertData(await api('/api/workspace/file', 'POST', { filePath: conflictProbe, content: 'agent version', isNew: true }));
  const staleSave = await api('/api/workspace/file', 'POST', { filePath: conflictProbe, content: 'my edits', expectedContent: 'stale snapshot' });
  assert.equal(staleSave.status, 409, 'A save against a stale buffer must be rejected as a conflict.');
  const staleBody = await staleSave.json();
  assert.equal(staleBody.success, false);
  assert.equal(staleBody.conflict, true, 'The 409 must be flagged as an explicit edit conflict so the client can offer a merge decision.');
  assert.equal(fs.readFileSync(path.join(workspace, conflictProbe), 'utf8'), 'agent version', 'A conflicted save must never touch the file on disk.');
  await assertData(await api('/api/workspace/file', 'POST', { filePath: conflictProbe, content: 'agent version 2', expectedContent: 'agent version' }));
  assert.equal(fs.readFileSync(path.join(workspace, conflictProbe), 'utf8'), 'agent version 2', 'A matching expectedContent must allow the save.');
  await assertData(await api('/api/workspace/file', 'POST', { filePath: conflictProbe, content: 'explicit overwrite' }));
  assert.equal(fs.readFileSync(path.join(workspace, conflictProbe), 'utf8'), 'explicit overwrite', 'Omitting expectedContent must stay an explicit force-save escape hatch.');
  console.log('PASS - M2.5 save conflict returns 409 plus a conflict flag, never writes, and force-save still works');

  fs.writeFileSync(path.join(workspace, '.env'), 'SECRET=must-not-leak');
  const previewOriginInfo = await assertData(await api('/api/preview/origin'));
  const previewOrigin = previewOriginInfo.origin;
  assert.match(previewOrigin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.notEqual(previewOrigin, url, 'Preview must use a separate browser origin');
  const preview = await fetch(`${previewOrigin}/preview/index.html`);
  assert.equal(preview.status, 200);
  const dedicatedCsp = preview.headers.get('content-security-policy') || '';
  assert.doesNotMatch(dedicatedCsp, /sandbox/);
  assert.match(dedicatedCsp, /frame-ancestors/);
  assert.equal((await fetch(`${previewOrigin}/preview/.env`)).status, 403);
  assert.equal((await fetch(`${previewOrigin}/preview/app.js`)).status, 200);
  const crossOrigin = await api('/api/workspace/root', 'GET', undefined, { Origin: previewOrigin });
  assert.equal(crossOrigin.status, 403);
  const previewSession = await assertData(await api('/api/preview/start', 'POST', { root: '', entry: 'index.html' }));
  assert.match(previewSession.session.id, /^preview_/);
  assert.equal(previewSession.session.status, 'ready');
  assert.equal((await assertData(await api(`/api/preview/status?id=${encodeURIComponent(previewSession.session.id)}`))).session.status, 'ready');
  assert.equal((await assertData(await api('/api/preview/stop', 'POST', { id: previewSession.session.id }))).stopped, true);
  assert.equal((await assertData(await api(`/api/preview/status?id=${encodeURIComponent(previewSession.session.id)}`))).session.status, 'stopped');
  await assertData(await api('/api/workspace/file', 'POST', { filePath: 'broken.html', content: '<script src="missing.js"></script>', isNew: true }));
  const invalidPreview = await api('/api/preview/start', 'POST', { root: '', entry: 'broken.html' });
  assert.equal(invalidPreview.status, 422);
  assert.match((await invalidPreview.json()).error, /Preview validation failed|not found/i);
  // Keep the negative preview fixture from changing the workspace shape used by
  // the later agent-generation assertion.
  fs.rmSync(path.join(workspace, 'broken.html'), { force: true });
  // Old API-origin URLs are opaque-sandboxed, never privileged.
  const legacy = await api('/preview/index.html');
  assert.match(legacy.headers.get('content-security-policy') || '', /sandbox allow-scripts/);
  console.log('PASS - isolated browser preview and protected files');

  const zip = await api('/api/download-zip');
  assert.equal(zip.status, 200);
  assert.equal(zip.headers.get('content-type'), 'application/zip');
  const zipBytes = Buffer.from(await zip.arrayBuffer());
  assert.equal(zipBytes.readUInt32LE(0), 0x04034b50);
  assert.equal(zipBytes.includes(Buffer.from('must-not-leak')), false);
  console.log('PASS - workspace ZIP export without Python');

  const denied = await api('/api/terminal/run', 'POST', { command: 'npm install' });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).needsApproval, true);
  const safe = await assertData(await api('/api/terminal/run', 'POST', { command: 'node --check app.js' }));
  assert.equal(safe.result.exitCode, 0);
  console.log('PASS - risky command approval and safe command execution');

  // One complete real agent operation, with the mock Qwen HTTP stream.
  const response = await api('/api/agent/run', 'POST', {
    userPrompt: 'Create a calculator project', mode: 'agent', conversationMode: 'agent', conversationHistory: [],
  });
  const events = await streamEvents(response);
  const done = events.find(e => e.event === 'done');
  assert.ok(done, `No agent completion event: ${JSON.stringify(events.slice(-2))}`);
  const root = done.result?.projectReport?.projectRoot;
  assert.ok(root && path.relative(workspace, root) && !path.relative(workspace, root).startsWith('..'),
    `Missing generated project report: ${JSON.stringify(done.result || {}).slice(0, 2000)}`);
  for (const name of ['index.html', 'style.css', 'script.js']) {
    assert.equal(fs.existsSync(path.join(root, name)), true, `Agent failed to write ${name}`);
  }
  const toolNames = done.result.toolCalls.map(c => c.name);
  assert.equal(toolNames.some(name => name === 'create_file' || name === 'write_file'), true);
  assert.equal(typeof done.result.taskId, 'string', 'Agent result must expose its persistent task id');
  assert.equal(done.result.rollback?.available, true, 'Agent result must expose a rollback journal for applied files');
  const rollbackInfo = await assertData(await api(`/api/tasks/${encodeURIComponent(done.result.taskId)}/rollback`));
  assert.equal(rollbackInfo.available, true);
  const rolledBack = await api(`/api/tasks/${encodeURIComponent(done.result.taskId)}/rollback`, 'POST', {});
  const rollbackResult = await rolledBack.json();
  assert.equal(rolledBack.ok, true, JSON.stringify(rollbackResult));
  assert.equal(rollbackResult.conflicts.length, 0);
  assert.equal(fs.existsSync(path.join(root, 'index.html')), false, 'Rollback should remove the generated project file');
  console.log('PASS - task-scoped conflict-safe rollback');
  const agentStatus = await assertData(await api('/api/agent/status'));
  assert.equal(agentStatus.busy, false, `Agent status remained busy after completion: ${JSON.stringify(agentStatus)}`);
  assert.equal(agentStatus.stopping, false);
  assert.equal(agentStatus.startedAt, null);
  assert.equal(agentStatus.stopRequestedAt, null);
  console.log('PASS - agent status is idle and observable after completion');
  const efficiency = await assertData(await api('/api/metrics/token-efficiency?limit=5'));
  assert.equal(efficiency.success, true);
  assert.ok(efficiency.sampleSize >= 1, 'Completed agent task should be represented in efficiency telemetry');
  assert.ok(Number.isFinite(efficiency.totalModelCalls), 'Efficiency telemetry must expose model-call totals');
  assert.ok(Number.isFinite(efficiency.totalToolCalls), 'Efficiency telemetry must expose tool-call totals');
  assert.ok(efficiency.tasks.some(task => Object.keys(task.byTool || {}).length > 0), 'Efficiency telemetry must expose per-tool metrics');
  assert.equal(Object.hasOwn(efficiency.tasks[0] || {}, 'userRequest'), false, 'Efficiency telemetry must not expose prompts');
  console.log('PASS - token-efficiency telemetry is aggregate-only and persisted');

  const interruptedResponse = await api('/api/agent/run', 'POST', {
    userPrompt: 'Create test.html for the checkpoint recovery scenario.',
    mode: 'agent', conversationMode: 'agent', conversationHistory: [],
  });
  const interruptedEvents = await streamEvents(interruptedResponse);
  const providerError = interruptedEvents.find(event => event.event === 'error');
  assert.ok(providerError, 'The simulated provider outage must reach the SSE error path.');
  assert.equal(providerError.resumable, true, 'The failed agent run must expose its saved checkpoint.');
  assert.match(providerError.taskId || '', /^task_/, 'The SSE error must carry the exact task ID.');
  const checkpointAnnouncement = interruptedEvents.find(event => event.event === 'task_started');
  assert.equal(checkpointAnnouncement?.taskId, providerError.taskId, 'The stream must expose the checkpoint before a connection can drop.');
  assert.ok(interruptedEvents.indexOf(checkpointAnnouncement) < interruptedEvents.indexOf(providerError));
  const { task: failedCheckpoint } = await assertData(await api(`/api/tasks/${encodeURIComponent(providerError.taskId)}`));
  assert.equal(failedCheckpoint.status, 'failed', 'The checkpoint must be resumable before a service restart.');
  assert.match(failedCheckpoint.userRequest, /checkpoint recovery scenario/);
  assert.equal(fs.existsSync(path.join(workspace, 'test.html')), true, 'The checkpoint must preserve the already-written file.');
  const resumeContext = await assertData(await api(`/api/tasks/${encodeURIComponent(providerError.taskId)}/resume-context`, 'POST', {}));
  assert.match(resumeContext.resumeContext, /test\.html/);
  const resumeRequest = { userPrompt: 'Continue', mode: 'agent', resumeTaskId: providerError.taskId, conversationMode: 'agent' };
  assert.equal((await api('/api/agent/run', 'POST', { ...resumeRequest, conversationMode: 'chat' })).status, 409);
  assert.equal((await api('/api/agent/run', 'POST', { ...resumeRequest, mode: 'plan', conversationMode: 'chat' })).status, 409);
  assert.equal((await api('/api/agent/run', 'POST', { ...resumeRequest, resumeTaskId: 'task_missing' })).status, 404);
  assert.equal((await assertData(await api('/api/agent/status'))).busy, false);
  console.log('PASS - provider failure preserves a resumable checkpoint and task ID');

  assert.equal((await assertData(await api('/api/agent/stop', 'POST', {}))).stopped, false);
  console.log('PASS - idle agent stop is safe and idempotent');
  console.log('PASS - mock Qwen multi-file generation with real filesystem writes');
  console.log('BACKEND HTTP E2E: ALL CHECKS PASSED');
} catch (error) {
  console.error('BACKEND HTTP E2E FAILED:', error);
  console.error(logs.slice(-15).join(''));
  process.exitCode = 1;
} finally {
  for (const processChild of processes) {
    try { processChild.kill(); } catch {}
  }
  fs.rmSync(base, { recursive: true, force: true });
}
