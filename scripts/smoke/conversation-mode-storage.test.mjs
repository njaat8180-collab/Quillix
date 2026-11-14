import test from 'node:test';
import assert from 'node:assert/strict';
import {
  conversationModeFromStorageEvent,
  conversationModeStorageKey,
  parseConversationMode,
  readConversationMode,
  writeConversationMode,
} from '../../src/shared/conversationModeStorage.ts';

test('server mode parser accepts only explicit Chat or Agent values', () => {
  assert.equal(parseConversationMode('chat'), 'chat');
  assert.equal(parseConversationMode('agent'), 'agent');
  for (const value of [undefined, null, '', 'ask', 'Agent', 1, {}]) {
    assert.equal(parseConversationMode(value), null);
  }
});

test('conversation mode preference is isolated by workspace and retains the Agent first-run default', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(readConversationMode('D:/project-a', () => storage), 'agent');
  assert.equal(writeConversationMode('D:/project-a', 'chat', () => storage), true);
  assert.equal(readConversationMode('D:/project-a', () => storage), 'chat');
  assert.equal(readConversationMode('D:/project-b', () => storage), 'agent');
  assert.equal(conversationModeStorageKey('D:/project-a'), 'quillix-conversation-mode:d:/project-a');
  assert.equal(conversationModeStorageKey('D:\\Project-A\\'), conversationModeStorageKey('d:/project-a'));
  assert.notEqual(conversationModeStorageKey('/Work/Project'), conversationModeStorageKey('/work/project'));
});

test('blocked browser storage fails closed to Chat and does not throw on save', () => {
  const denied = () => { throw new Error('storage denied'); };
  assert.equal(readConversationMode('D:/project', denied), 'chat');
  assert.equal(writeConversationMode('D:/project', 'agent', denied), false);
  assert.equal(readConversationMode('', denied), 'chat');
  assert.equal(writeConversationMode('', 'chat', denied), false);
});

test('cross-window changes are scoped to the active workspace and invalid values fail closed', () => {
  const key = conversationModeStorageKey('D:/project');
  assert.equal(conversationModeFromStorageEvent('D:/project', key, 'chat'), 'chat');
  assert.equal(conversationModeFromStorageEvent('D:/project', key, 'agent'), 'agent');
  assert.equal(conversationModeFromStorageEvent('D:/project', key, null), 'chat');
  assert.equal(conversationModeFromStorageEvent('D:/other', key, 'agent'), null);
  assert.equal(conversationModeFromStorageEvent('D:/project', null, 'agent'), null);
});
