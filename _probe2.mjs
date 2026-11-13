import { routeConversation, classifyIntent } from './src/server/intentRouter.ts';
const prompts = [
  'now replace hello with high',
  'hello ki jagah hi likh do',
  'us website me hello ki jagah high kar do',
  'ab jo iske andar ye hello ki jagah hi likh do',
  'is website me hello ko high me badal do',
];
for (const p of prompts) {
  const c = classifyIntent(p, { hasProjectContext: true, currentFile: 'index.html' });
  const r = routeConversation(p, { hasProjectContext: true, currentFile: 'index.html', conversationMode: 'agent', workflowMode: 'agent' });
  console.log(JSON.stringify(p));
  console.log('   classifyIntent:', c.kind, '|', c.reason);
  console.log('   route(agent mode):', r.kind, '|', r.reason);
  const r2 = routeConversation(p, { hasProjectContext: true, currentFile: 'index.html', conversationMode: 'chat', workflowMode: 'chat' });
  console.log('   route(chat mode): ', r2.kind, '|', r2.reason);
}
