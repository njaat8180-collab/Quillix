/**
 * QUILLIX MISSION CONTROL — VS Code sidebar.
 *
 * Dependency-free CommonJS so it installs and runs from a source checkout with
 * no build step and no network. It only READS the workspace-local
 * `.quillix/mission/goal-state.json` (the same persisted state the NUVRO AI
 * Studio panel uses) and renders it in a restricted webview.
 *
 * Nothing here is estimated or fabricated: a missing/invalid state file shows
 * an explicit "not available" message instead of fake progress.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const vscode = require('vscode');

const MISSION_RELATIVE = path.join('.quillix', 'mission', 'goal-state.json');
/** Mirrors src/shared/missionState.ts so both surfaces agree. */
const MISSION_STATE_PATH = ['.quillix', 'mission', 'goal-state.json'];
const REFRESH_INTERVAL_MS = 15000;

const GATE_TONES = { pass: '#3fb950', partial: '#d29922', blocked: '#d29922', open: '#8b949e', fail: '#f85149' };
const TEST_TONES = { pass: '#3fb950', fail: '#f85149', blocked: '#d29922', skipped: '#8b949e' };
const SEVERITY_TONES = { critical: '#f85149', high: '#f85149', medium: '#d29922', low: '#8b949e' };
const GATE_STATUSES = ['open', 'pass', 'partial', 'fail', 'blocked'];
const TEST_STATUSES = ['pass', 'fail', 'blocked', 'skipped'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];

function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function asString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function asNumber(value, fallback) {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function asIso(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

function parseMissionState(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const degraded = !raw || typeof raw !== 'object';
  const counts = input.counts && typeof input.counts === 'object' ? input.counts : {};
  const phase = input.phase && typeof input.phase === 'object' ? input.phase : {};
  const benchmarks = input.benchmarks && typeof input.benchmarks === 'object' ? input.benchmarks : {};
  const activity = input.activity && typeof input.activity === 'object' ? input.activity : {};
  const parsed = {
    completed: asNumber(counts.completed, 0),
    inProgress: asNumber(counts.inProgress, 0),
    pending: asNumber(counts.pending, 0),
    total: asNumber(counts.total, 0),
  };
  const derivedTotal = parsed.total > 0 ? parsed.total : parsed.completed + parsed.inProgress + parsed.pending;
  const derivedProgress = derivedTotal > 0
    ? Math.max(0, Math.min(100, Math.round((parsed.completed / derivedTotal) * 100)))
    : 0;

  return {
    degraded,
    mission: asString(input.mission, 'QUILLIX'),
    deadline: asIso(input.deadline),
    phase: {
      id: asString(phase.id, 'P1'),
      title: asString(phase.title, 'Unknown phase'),
    },
    currentTask: asString(input.currentTask, '—'),
    nextPlannedTask: asString(input.nextPlannedTask, '—'),
    latestCheckpoint: asString(input.latestCheckpoint, '—'),
    counts: parsed,
    verifiedProgressPercent: asNumber(input.verifiedProgressPercent, derivedProgress),
    nextTasks: asList(input.nextTasks).filter(item => typeof item === 'string' && item.trim()),
    blockers: asList(input.blockers).flatMap(item => {
      const entry = item && typeof item === 'object' ? item : {};
      const id = asString(entry.id, '');
      if (!id) return [];
      return [{
        id,
        severity: SEVERITIES.includes(entry.severity) ? entry.severity : 'low',
        title: asString(entry.title, 'Untitled blocker'),
        approvalRequired: entry.approvalRequired === true,
      }];
    }),
    tests: asList(input.tests).flatMap(item => {
      const entry = item && typeof item === 'object' ? item : {};
      const name = asString(entry.name, '');
      if (!name) return [];
      return [{
        name,
        status: TEST_STATUSES.includes(entry.status) ? entry.status : 'skipped',
        detail: asString(entry.detail, ''),
      }];
    }),
    releaseGates: asList(input.releaseGates).flatMap(item => {
      const entry = item && typeof item === 'object' ? item : {};
      const id = asString(entry.id, '');
      if (!id) return [];
      return [{
        id,
        title: asString(entry.title, 'Untitled gate'),
        status: GATE_STATUSES.includes(entry.status) ? entry.status : 'open',
        detail: asString(entry.detail, ''),
      }];
    }),
    benchmarks: {
      cursorBaseline: asString(benchmarks.cursorBaseline, 'not-collected'),
      harnessVerified: benchmarks.harnessVerified === true,
      note: asString(benchmarks.note, ''),
    },
    activity: {
      lastVerifiedAt: asIso(activity.lastVerifiedAt),
      current: asString(activity.current, '—'),
      note: asString(activity.note, ''),
    },
  };
}

function countdown(deadline, now) {
  if (!deadline) return null;
  const target = Date.parse(deadline);
  if (Number.isNaN(target)) return null;
  const remaining = target - now;
  if (remaining <= 0) return { expired: true, critical: true, days: 0, hours: 0, minutes: 0 };
  return {
    expired: false,
    critical: remaining <= 86400000,
    days: Math.floor(remaining / 86400000),
    hours: Math.floor((remaining % 86400000) / 3600000),
    minutes: Math.floor((remaining % 3600000) / 60000),
  };
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function renderMission(state, sourceLabel, now) {
  if (!state) {
    return `<p class="warn">Mission state is not available yet.<br/>Expected <code>${escapeHtml(MISSION_RELATIVE)}</code> in the open workspace.</p>`;
  }
  if (state.degraded) {
    return '<p class="warn"><strong>goal-state.json could not be read or parsed.</strong><br/>Nothing is estimated - showing defaults.</p>';
  }

  const remaining = countdown(state.deadline, now);
  const countdownHtml = remaining
    ? (remaining.expired
      ? '<span class="chip chip-danger">DEADLINE PASSED</span>'
      : `<span class="chip ${remaining.critical ? 'chip-critical' : 'chip-neutral'}">${remaining.days}d ${pad2(remaining.hours)}h ${pad2(remaining.minutes)}m</span>`)
    : '<span class="chip chip-neutral">no deadline</span>';

  const counts = state.counts;
  const gates = state.releaseGates.reduce((acc, gate) => {
    acc[gate.status] = (acc[gate.status] || 0) + 1;
    return acc;
  }, {});
  const gateTotals = GATE_STATUSES.map(key => `${gates[key] || 0} ${key}`).join(' · ');
  const tests = state.tests.reduce((acc, test) => {
    acc[test.status] = (acc[test.status] || 0) + 1;
    return acc;
  }, {});
  const testTotals = TEST_STATUSES.map(key => `${tests[key] || 0} ${key}`).join(' · ');

  const gateRows = state.releaseGates.map(gate => `<li><span class="row"><span><span class="dot" style="background:${GATE_TONES[gate.status] || GATE_TONES.open}"></span>${escapeHtml(gate.title)}${gate.detail ? ` <em>${escapeHtml(gate.detail)}</em>` : ''}</span><b style="color:${GATE_TONES[gate.status] || GATE_TONES.open}">${escapeHtml(gate.status)}</b></span></li>`).join('');
  const testRows = state.tests.map(test => `<li><span class="row"><span class="mono">${escapeHtml(test.name)}${test.detail ? ` <em>${escapeHtml(test.detail)}</em>` : ''}</span><b style="color:${TEST_TONES[test.status] || TEST_TONES.skipped}">${escapeHtml(test.status)}</b></span></li>`).join('');
  const blockerRows = state.blockers.map(blocker => `<li><span class="row"><span><span class="mono">${escapeHtml(blocker.id)}</span> ${escapeHtml(blocker.title)}${blocker.approvalRequired ? ' <span class="tag">approval required</span>' : ''}</span><b style="color:${SEVERITY_TONES[blocker.severity] || SEVERITY_TONES.low}">${escapeHtml(blocker.severity)}</b></span></li>`).join('');
  const nextRows = state.nextTasks.map(task => `<li class="row"><span>${escapeHtml(task)}</span></li>`).join('');

  const section = (title, body) => body ? `<section><h3>${escapeHtml(title)}</h3>${body}</section>` : '';

  return [
    `<div class="head"><span class="dot dot-live"></span><strong>QUILLIX MISSION CONTROL</strong><span class="src">${escapeHtml(state.mission)}</span></div>`,
    `<div class="deadline">${countdownHtml}<span class="src">${escapeHtml(state.deadline || 'no deadline configured')}</span></div>`,
    section('Verified progress', `
      <div class="progress"><div class="progress-fill" style="width:${state.verifiedProgressPercent}%"></div></div>
      <p class="row"><span><b>${state.verifiedProgressPercent}%</b> verified</span><span class="mono">done ${counts.completed} · active ${counts.inProgress} · pending ${counts.pending} · total ${counts.total}</span></p>`),
    section('Phase & task', `<p><b>Phase ${escapeHtml(state.phase.id)}</b> - ${escapeHtml(state.phase.title)}</p><p><b>Current:</b> ${escapeHtml(state.currentTask)}</p><p><b>Next:</b> ${escapeHtml(state.nextPlannedTask)}</p>`),
    section(`Release gates <em class="src">${escapeHtml(gateTotals)}</em>`, gateRows ? `<ul>${gateRows}</ul>` : ''),
    section(`Test results <em class="src">${escapeHtml(testTotals)}</em>`, testRows ? `<ul>${testRows}</ul>` : ''),
    section('Active blockers', blockerRows ? `<ul>${blockerRows}</ul>` : ''),
    section('Development activity', `<p>${escapeHtml(state.activity.current)}</p><p class="src">last verified ${escapeHtml(state.activity.lastVerifiedAt || 'n/a')}</p><p class="src">checkpoint ${escapeHtml(state.latestCheckpoint)}</p>${state.activity.note ? `<p class="src">${escapeHtml(state.activity.note)}</p>` : ''}`),
    section('Cursor benchmark', `<p class="row"><span>Cursor baseline <b>${escapeHtml(state.benchmarks.cursorBaseline)}</b></span><span>harness ${state.benchmarks.harnessVerified ? 'verified' : 'unverified'}</span></p>${state.benchmarks.note ? `<p class="src">${escapeHtml(state.benchmarks.note)}</p>` : ''}`),
    section('Next tasks', nextRows ? `<ol>${nextRows}</ol>` : ''),
    `<p class="src footer">source ${escapeHtml(sourceLabel)}</p>`,
  ].filter(Boolean).join('\n');
}

function webviewShell() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
<title>QUILLIX MISSION CONTROL</title>
<style>
  body { font: 12px/1.45 var(--vscode-font-family, system-ui, sans-serif); color: var(--vscode-foreground, #c9d1d9); padding: 8px; }
  h3 { font-size: 10px; text-transform: uppercase; letter-spacing: .12em; margin: 12px 0 6px; color: var(--vscode-descriptionForeground, #8b949e); }
  ul, ol { margin: 0; padding: 0; list-style: none; }
  ol { counter-reset: task; }
  ol li::before { counter-increment: task; content: counter(task) '. '; color: var(--vscode-descriptionForeground, #8b949e); }
  li { padding: 2px 0; }
  section { border-bottom: 1px solid var(--vscode-panel-border, #30363d); padding-bottom: 8px; }
  .row { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
  .head { display: flex; align-items: center; gap: 6px; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; }
  .deadline { margin: 6px 0 4px; }
  .chip { border: 1px solid var(--vscode-panel-border, #30363d); border-radius: 999px; padding: 1px 8px; font-family: ui-monospace, monospace; font-size: 11px; }
  .chip-critical { border-color: #d29922; color: #d29922; }
  .chip-danger { border-color: #f85149; color: #f85149; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
  .dot-live { animation: pulse 2s ease-in-out infinite; background: var(--vscode-textLink-foreground, #58a6ff); }
  @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .45 } }
  .mono { font-family: ui-monospace, monospace; }
  .src { color: var(--vscode-descriptionForeground, #8b949e); font-weight: 400; }
  .warn { color: #d29922; }
  .tag { border: 1px solid #d29922; color: #d29922; border-radius: 4px; padding: 0 4px; font-size: 10px; }
  .progress { height: 6px; border-radius: 999px; background: var(--vscode-panel-border, #30363d); overflow: hidden; margin: 6px 0; }
  .progress-fill { height: 100%; background: #3fb950; }
  em { font-style: normal; color: var(--vscode-descriptionForeground, #8b949e); }
  .footer { margin-top: 12px; }
</style>
</head>
<body>
  <p class="src">Loading mission state...</p>
</body>
</html>`;
}

/** Reads the workspace-local mission state. Returns { state, source, error }. */
function readMissionState() {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!folder) return { state: null, source: 'no workspace', error: 'Open the NUVRO AI workspace to see mission state.' };
  const file = path.join(folder.uri.fsPath, ...MISSION_STATE_PATH);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return { state: parseMissionState(JSON.parse(raw)), source: file, error: null };
  } catch (cause) {
    if (cause && cause.code === 'ENOENT') {
      return { state: null, source: file, error: `Mission state not found (expected ${MISSION_RELATIVE}).` };
    }
    return { state: parseMissionState(null), source: file, error: `goal-state.json could not be parsed: ${cause && cause.message ? cause.message : 'unknown error'}` };
  }
}

class MissionControlViewProvider {
  constructor(context) {
    this.context = context;
    this.view = null;
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: false, localResourceRoots: [] };
    webviewView.webview.html = webviewShell();
    webviewView.onDidDispose(() => { this.view = null; });
    this.refresh();
  }

  refresh() {
    if (!this.view) return;
    const { state, source } = readMissionState();
    this.view.webview.html = renderMission(state, source, Date.now());
  }
}

function activate(context) {
  const provider = new MissionControlViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('quillix.missionControl', provider, { webviewOptions: { retainContextWhenHidden: true } }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('quillix.missionControl.refresh', () => {
      provider.refresh();
      return undefined;
    }),
    vscode.commands.registerCommand('quillix.missionControl.openMissionFolder', async () => {
      const { source } = readMissionState();
      const target = source && source !== 'no workspace' ? path.dirname(source) : null;
      if (!target) {
        vscode.window.showWarningMessage('No workspace folder is open.');
        return undefined;
      }
      try {
        await require('vscode').commands.executeCommand('revealFileInOS');
      } catch {
        vscode.window.showInformationMessage(`Mission files: ${target}`);
      }
      return undefined;
    }),
  );

  // Keep the sidebar live: poll frequently, and immediately on file change.
  const timer = setInterval(() => provider.refresh(), REFRESH_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  const watcher = vscode.workspace.createFileSystemWatcher('**/' + MISSION_RELATIVE.replace(/\\/g, '/'));
  watcher.onDidChange(() => provider.refresh());
  watcher.onDidCreate(() => provider.refresh());
  context.subscriptions.push(watcher);
  return undefined;
}

function deactivate() {
  return undefined;
}

module.exports = { activate, deactivate };

