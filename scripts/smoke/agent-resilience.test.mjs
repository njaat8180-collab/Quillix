/** Deterministic, dependency-free regression tests for key agent safeguards. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PhaseTracker, adaptivePhaseDefinitions, classifyRequestKind } from '../../src/server/phases.ts';
import { inspectBrowserScripts, checkExplicitWebRequirements } from '../../src/server/browserChecks.ts';
import { mayRetryToolFailure, isPermissionBlock } from '../../src/server/toolRecovery.ts';
import { requiredProjectFiles, isSingleFileCreationRequest } from '../../src/server/projectContract.ts';

test('the workflow is specific to each request, not always the same 15 phases', () => {
  const website = adaptivePhaseDefinitions('project', 'Build a responsive To-Do website. Run tests and show preview.').map(p => p.id);
  const fix = adaptivePhaseDefinitions('fix', 'Fix the CSS spacing in the existing component.').map(p => p.id);
  const explanation = adaptivePhaseDefinitions('analyze', 'Explain how this function works.').map(p => p.id);
  assert.notDeepEqual(website, fix);
  assert.notDeepEqual(fix, explanation);
  assert.ok(website.includes('implement-features'));
  assert.ok(website.includes('build'));
  assert.equal(fix.includes('build'), false);
  assert.equal(explanation.includes('apply'), false);
  assert.ok(website.length < 15);
});

test('repair steps appear after a failure and never before it', () => {
  const tracker = new PhaseTracker('project', 'Build a calculator website');
  assert.equal(tracker.getPhases().some(p => p.id === 'error-analysis'), false);
  tracker.activateRepairFlow();
  const phases = tracker.getPhases();
  assert.equal(phases.filter(p => p.id === 'fixes').length, 1);
  assert.equal(phases.filter(p => p.id === 'retesting').length, 1);
  tracker.activateRepairFlow();
  assert.equal(tracker.getPhases().filter(p => p.id === 'fixes').length, 1);
});

test('requested but unverified steps fail rather than becoming not needed', () => {
  const tracker = new PhaseTracker('project', 'Create a website with working buttons.');
  tracker.complete('understand');
  tracker.complete('inspect');
  const final = tracker.finalize(false);
  assert.equal(final.find(p => p.id === 'completion')?.status, 'failed');
  assert.equal(final.find(p => p.id === 'implement-core')?.status, 'failed');
  assert.equal(final.filter(p => p.status === 'skipped').length, 0);
});

test('HTML detects a Node Express server accidentally linked as browser script', () => {
  const html = '<!doctype html><html><head></head><body><script src="script.js"></script></body></html>';
  const js = 'const express = require("express");\nconst app = express();\napp.listen(3000);';
  const result = inspectBrowserScripts('TodoList/index.html', html, p => p === 'TodoList/script.js' ? js : undefined);
  assert.equal(result.length, 1);
  assert.equal(result[0].check, 'browser-compatibility');
  assert.match(result[0].error, /require/);
});

test('HTML does not reject normal DOM browser scripts', () => {
  const html = '<button id="addTaskBtn">Add</button><script src="script.js"></script>';
  const js = 'document.getElementById("addTaskBtn").addEventListener("click", () => localStorage.setItem("tasks", "[]"));';
  assert.deepEqual(inspectBrowserScripts('TodoList/index.html', html, () => js), []);
});

test('HTML rejects a script reference outside the workspace', () => {
  const html = '<script src="../../secret.js"></script>';
  const failures = inspectBrowserScripts('app/index.html', html, () => 'secret');
  assert.equal(failures.length, 1);
  assert.match(failures[0].error, /escapes/);
});

test('explicit localStorage requirement is enforced, not inferred from HTML syntax', () => {
  const paths = ['TodoList/index.html', 'TodoList/script.js'];
  const prompt = 'Create a To-Do web app. Save tasks using localStorage.';
  const html = '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><main><h1>Todo</h1><button>Add task</button></main><script src="script.js"></script></body></html>';
  const missingPersistence = file => file.endsWith('index.html')
    ? html
    : file.endsWith('style.css')
      ? 'body { color: red; }'
      : 'document.querySelector("button").addEventListener("click", () => console.log("todo"));';
  const errors = checkExplicitWebRequirements(prompt, paths, missingPersistence);
  assert.equal(errors.length, 1);
  assert.match(errors[0].error, /localStorage/);
  const fixed = checkExplicitWebRequirements(prompt, paths, file => file.endsWith('index.html')
    ? html
    : file.endsWith('style.css')
      ? 'body { color: red; }'
      : 'localStorage.setItem("tasks", "[]")');
  assert.equal(fixed.length, 0);
});

test('Hindi and Hinglish create/fix instructions enter the correct agent workflow', () => {
  assert.equal(classifyRequestKind('एक वेबसाइट बनाओ'), 'project');
  assert.equal(classifyRequestKind('प्रोजेक्ट बना दो'), 'project');
  assert.equal(classifyRequestKind('ये बग ठीक करो'), 'fix');
  assert.equal(classifyRequestKind('Explain the architecture'), 'analyze');
});

test('transient read retries are bounded and never replay writes or shell commands', () => {
  assert.equal(mayRetryToolFailure('read_file', 'EBUSY: try again', 0), true);
  assert.equal(mayRetryToolFailure('read_file', 'EBUSY: try again', 1), false);
  assert.equal(mayRetryToolFailure('write_file', 'EBUSY: try again', 0), false);
  assert.equal(mayRetryToolFailure('run_command', 'ETIMEDOUT', 0), false);
  assert.equal(mayRetryToolFailure('read_file', 'ENOENT', 0), false);
  assert.equal(isPermissionBlock('approval denied by user'), true);
  assert.equal(isPermissionBlock('Command rejected: the user denied authorization.'), true);
  assert.equal(isPermissionBlock('Command blocked pending user approval: dangerous command'), true);
  assert.equal(isPermissionBlock('ordinary command failed with exit code 1'), false);
  assert.equal(mayRetryToolFailure('read_file', 'ETIMEDOUT', 0, true), false);
});

test('common plain web projects require all three files, Python projects do not', () => {
  assert.deepEqual(requiredProjectFiles('Create a calculator project.'), ['index.html', 'style.css', 'script.js']);
  assert.deepEqual(requiredProjectFiles('Build a To-Do app using HTML, CSS and JavaScript'), ['index.html', 'style.css', 'script.js']);
  assert.deepEqual(requiredProjectFiles('Build a car game using Python'), []);
});

test('inline CSS and JavaScript website requests require one index.html file', () => {
  assert.equal(isSingleFileCreationRequest('Create a website and add all CSS and JS in one HTML file'), true);
  assert.deepEqual(requiredProjectFiles('Create a website and add all CSS and JS in one HTML file'), ['index.html']);
});


test('explicit index.html page requests write into workspace without unnecessary folder', () => {
  const prompt='create a index.html page with hello world heading and some animated temples in background';
  assert.equal(classifyRequestKind(prompt), 'project');
  assert.equal(isSingleFileCreationRequest(prompt), true);
  assert.deepEqual(requiredProjectFiles(prompt, true), ['index.html']);
  assert.equal(isSingleFileCreationRequest('Create a calculator project'), false);
});
