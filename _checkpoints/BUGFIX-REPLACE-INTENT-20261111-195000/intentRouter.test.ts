import { describe, it, expect } from 'vitest';
import { classifyIntent, hasExplicitWorkspaceAction, routeConversationIntent } from '../intentRouter.js';
import { approvedHtmlStageContinuation, HTML_STAGE_APPROVAL_MESSAGE } from '../projectContract.js';

describe('Intent Router — Normal Chat vs Coding Agent', () => {
  const chatExamples = [
    'Hi',
    'Hello',
    'hey there!',
    'How are you?',
    'Who are you?',
    'What can you do?',
    'thanks',
    'Give me advice about my project',
    'What should I improve in this application?',
    "What do you think about my project's architecture?",
    'Explain Python classes.',
    'What is a closure in JavaScript?',
    'Explain the difference between REST and GraphQL',
    'Give me some tips about my code',
  ];

  const agentExamples = [
    'Create a Python calculator.',
    'Build a shooting game from scratch.',
    'Fix this project.',
    'Add login functionality.',
    'Create a website.',
    'Find and fix the bug.',
    'Refactor this file.',
    'Create all required files.',
    'Run the project and fix errors.',
    'Run npm test',
    'Open package.json and check the dependencies.',
    'Create a new file called utils.py with a helper function',
    'Delete the old component',
    'Initialize a new react project',
    'run the app',
  ];

  it('classifies plain conversation as chat — NEVER tool use', () => {
    for (const prompt of chatExamples) {
      const result = classifyIntent(prompt);
      expect(result.kind, `expected chat for: "${prompt}"`).toBe('chat');
    }
  });

  it('classifies coding/project/terminal requests as agent', () => {
    for (const prompt of agentExamples) {
      const result = classifyIntent(prompt);
      expect(result.kind, `expected agent for: "${prompt}"`).toBe('agent');
    }
  });

  it('is deterministic and always returns a reason', () => {
    const a = classifyIntent('Create a file');
    const b = classifyIntent('Create a file');
    expect(a.kind).toBe(b.kind);
    expect(typeof a.reason).toBe('string');
    expect(a.reason.length).toBeGreaterThan(0);
  });

  it('defaults to chat on ambiguous input (never fires tools by accident)', () => {
    expect(classifyIntent('').kind).toBe('chat');
    expect(classifyIntent('hmm interesting').kind).toBe('chat');
    expect(classifyIntent('the weather is nice today').kind).toBe('chat');
  });

  it('routes common coding objects and misspellings to the agent', () => {
    expect(classifyIntent('Can you create calculater using HTML CSS JavaScript?').kind).toBe('agent');
    expect(classifyIntent('Create an AI harness using html css js').kind).toBe('agent');
    expect(classifyIntent('Create a code editor').kind).toBe('agent');
  });

  it('routes terse active-project continuations to the agent without routing questions', () => {
    expect(classifyIntent('Now connect both files', { hasProjectContext: true }).kind).toBe('agent');
    expect(classifyIntent('अब इन दोनों files को एक साथ जोड़ दो', { hasProjectContext: true }).kind).toBe('agent');
    expect(classifyIntent('अब इसका background में ये image लगा दो', { hasProjectContext: true }).kind).toBe('agent');
    expect(classifyIntent('The website looks good, now add a background image', { hasProjectContext: true }).kind).toBe('agent');
    expect(classifyIntent('इसमें login और sign-in जोड़ दो', { hasProjectContext: true }).kind).toBe('agent');
  expect(classifyIntent('ok start phase 2', { hasProjectContext: true }).kind).toBe('agent');
  expect(classifyIntent('approved, continue with the next phase', { hasProjectContext: true }).kind).toBe('agent');
  expect(classifyIntent('work on it now', { hasProjectContext: true }).kind).toBe('agent');
    expect(classifyIntent('now replace hello with high', { hasProjectContext: true }).kind).toBe('agent');
    expect(classifyIntent('replace hello with hi', { hasProjectContext: true }).kind).toBe('agent');
    expect(classifyIntent('Now replace "Hello World" with "Hello" in index.html file.', { hasProjectContext: true }).kind).toBe('agent');
  expect(classifyIntent('good', { hasProjectContext: true }).kind).toBe('chat');
    expect(classifyIntent('How do I connect HTML and CSS?', { hasProjectContext: true }).kind).toBe('chat');
    expect(classifyIntent('Now connect both files', { hasProjectContext: false }).kind).toBe('chat');
  });

  it('routes short editor follow-ups to the open file while preserving chat questions', () => {
    const editor = { currentFile: 'src/styles.css' };
    for (const prompt of ['upgrade CSS', 'improve styling', 'make it cleaner', 'fix spacing', 'CSS सुधारो', 'improve it', 'make responsive', 'polish this', 'ठीक करो']) {
      expect(classifyIntent(prompt, editor).kind, `expected agent for: "${prompt}"`).toBe('agent');
    }
    for (const prompt of ['How do I improve CSS?', 'What is CSS?', 'thanks']) {
      expect(classifyIntent(prompt, editor).kind, `expected chat for: "${prompt}"`).toBe('chat');
    }
    expect(classifyIntent('upgrade CSS').kind).toBe('agent');
  });

  it('keeps the explicit Chat/Agent lock authoritative across workflow tabs', () => {
    expect(routeConversationIntent('upgrade CSS', {
      conversationMode: 'agent', workflowMode: 'ask', currentFile: 'src/styles.css',
    }).kind).toBe('agent');
    expect(routeConversationIntent('improve it', {
      conversationMode: 'agent', workflowMode: 'review', currentFile: 'src/styles.css',
    }).kind).toBe('agent');
    expect(routeConversationIntent('Hello', {
      conversationMode: 'agent', workflowMode: 'ask', currentFile: 'src/styles.css',
    }).kind).toBe('chat');
    expect(routeConversationIntent('upgrade CSS', {
      conversationMode: 'chat', workflowMode: 'agent', currentFile: 'src/styles.css',
    }).kind).toBe('chat');
    expect(routeConversationIntent('upgrade CSS', {
      workflowMode: 'ask', currentFile: 'src/styles.css',
    }).kind).toBe('chat');
    expect(routeConversationIntent('upgrade CSS', {
      workflowMode: 'plan', currentFile: 'src/styles.css',
    }).kind).toBe('chat');
    expect(routeConversationIntent('How should I approach this feature?', {
      workflowMode: 'plan', hasProjectContext: true,
    }).kind).toBe('chat');
  });

  it('does not demote renderer-approved terse selected-file edits back to Chat on the server', () => {
    const selectedFile = { conversationMode: 'agent' as const, workflowMode: 'agent', currentFile: 'src/styles.css' };
    for (const prompt of ['more animations', 'less whitespace', 'mobile friendly', 'dark theme', 'rounded corners']) {
      expect(routeConversationIntent(prompt, selectedFile).kind, prompt).toBe('agent');
    }
    for (const prompt of ['How do I improve CSS?', 'What is CSS?', 'thanks']) {
      expect(routeConversationIntent(prompt, selectedFile).kind, prompt).toBe('chat');
    }
    expect(routeConversationIntent('more animations', {
      ...selectedFile, conversationMode: 'chat',
    }).kind).toBe('chat');
  });

  it('lets project memory resolve an action target without converting ordinary questions into actions', () => {
    expect(hasExplicitWorkspaceAction('fix the car game')).toBe(true);
    expect(hasExplicitWorkspaceAction('मेरे प्रोजेक्ट में login जोड़ दो')).toBe(true);
    expect(hasExplicitWorkspaceAction('What do you think about the car game?')).toBe(false);
    expect(hasExplicitWorkspaceAction('Hello')).toBe(false);
  });

  it('applies the mode lock before approval and remembered-project fallback', () => {
    const remembered = { matchesRememberedProject: () => true };
    expect(routeConversationIntent('fix the car', { ...remembered, workflowMode: 'plan' }).kind).toBe('chat');
    expect(routeConversationIntent('approved', { workflowMode: 'plan', approvedContinuation: true }).kind).toBe('chat');
    expect(routeConversationIntent('approved', { conversationMode: 'chat', approvedContinuation: true }).kind).toBe('chat');
    expect(routeConversationIntent('approved', { conversationMode: 'agent', approvedContinuation: true }).kind).toBe('agent');
    expect(routeConversationIntent('fix the car', remembered).kind).toBe('agent');
    expect(routeConversationIntent('How do I fix the car?', remembered).kind).toBe('chat');
    expect(routeConversationIntent('Give me tips to fix the car', remembered).kind).toBe('chat');
    expect(routeConversationIntent('Give me tips to fix the website', {
      ...remembered, conversationMode: 'agent', currentFile: 'index.html', hasProjectContext: true,
    }).kind).toBe('chat');
  });

  it('only accepts stage approval as a direct reply to the completion message', () => {
    const history = [
      { role: 'user', content: 'Build a website. First write HTML and after I approve, add CSS and JS.' },
      { role: 'assistant', content: HTML_STAGE_APPROVAL_MESSAGE },
    ];
    expect(approvedHtmlStageContinuation('approved', history)).toContain('Create style.css and script.js');
    expect(approvedHtmlStageContinuation('okay', [...history, { role: 'user', content: 'What does CSS do?' }])).toBeUndefined();
  });
});
