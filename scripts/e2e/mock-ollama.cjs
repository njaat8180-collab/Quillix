/**
 * Mock Ollama server that simulates qwen2.5-coder:3b — including its
 * real-world failure mode of writing TOOL CALLS AS TEXT instead of using
 * the native tool_calls field. Turn selection is stateless: it is derived
 * from the conversation content of each request.
 */
const http = require('http');

let chatCallCount = 0;

const FILES = {
  'index.html': [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '  <title>To-Do List</title>',
    '  <link rel="stylesheet" href="style.css">',
    '</head>',
    '<body>',
    '  <main class="container">',
    '    <h1>To-Do List</h1>',
    '    <form id="task-form">',
    '      <input id="task-input" placeholder="Add a task">',
    '      <button type="submit">Add</button>',
    '    </form>',
    '    <ul id="task-list"></ul>',
    '    <div class="stats">',
    '      <span id="total-count">Total: 0</span>',
    '      <span id="completed-count">Completed: 0</span>',
    '      <button id="clear-completed">Clear completed</button>',
    '    </div>',
    '  </main>',
    '  <script src="app.js"></script>',
    '</body>',
    '</html>',
  ].join('\n'),
  'style.css': [
    'body { font-family: system-ui, sans-serif; background: #f4f5f7; margin: 0; }',
    '.container { max-width: 520px; margin: 48px auto; padding: 24px; background: #fff; border-radius: 12px; }',
    'h1 { margin-top: 0; }',
    'form { display: flex; gap: 8px; }',
    'input { flex: 1; padding: 10px; border: 1px solid #ccc; border-radius: 8px; }',
    'button { padding: 10px 16px; border: none; border-radius: 8px; background: #2563eb; color: #fff; cursor: pointer; }',
    'ul { list-style: none; padding: 0; }',
    'li { display: flex; align-items: center; gap: 10px; padding: 10px; border-bottom: 1px solid #eee; }',
    'li.done span { text-decoration: line-through; color: #999; }',
    '.stats { display: flex; justify-content: space-between; margin-top: 16px; }',
    '@media (max-width: 600px) { .container { margin: 12px; } }',
  ].join('\n'),
  'app.js': [
    '// To-Do List application logic',
    "const form = document.getElementById('task-form');",
    "const input = document.getElementById('task-input');",
    "const list = document.getElementById('task-list');",
    'function loadTasks() {',
    "  return JSON.parse(localStorage.getItem('todo-tasks') || '[]');",
    '}',
    'function saveTasks(tasks) {',
    "  localStorage.setItem('todo-tasks', JSON.stringify(tasks));",
    '}',
    'function render() {',
    '  const tasks = loadTasks();',
    "  list.innerHTML = '';",
    '  tasks.forEach((task, i) => {',
    '    const li = document.createElement("li");',
    '    li.textContent = task.text;',
    '    if (task.done) li.classList.add("done");',
    '    li.addEventListener("click", () => { tasks[i].done = !tasks[i].done; saveTasks(tasks); render(); });',
    '    const del = document.createElement("button");',
    '    del.textContent = "Delete";',
    '    del.addEventListener("click", (e) => { e.stopPropagation(); tasks.splice(i, 1); saveTasks(tasks); render(); });',
    '    li.appendChild(del);',
    '    list.appendChild(li);',
    '  });',
    '  document.getElementById("total-count").textContent = "Total: " + tasks.length;',
    '  document.getElementById("completed-count").textContent = "Completed: " + tasks.filter(t => t.done).length;',
    '}',
    'form.addEventListener("submit", (e) => {',
    '  e.preventDefault();',
    '  if (!input.value.trim()) return;',
    '  const tasks = loadTasks();',
    '  tasks.push({ text: input.value.trim(), done: false });',
    '  saveTasks(tasks);',
    '  input.value = "";',
    '  render();',
    '});',
    'document.getElementById("clear-completed").addEventListener("click", () => {',
    '  saveTasks(loadTasks().filter(t => !t.done));',
    '  render();',
    '});',
    'render();',
  ].join('\n'),
};

const BROKEN_APP_JS = [
  '// To-Do List application logic — NOTE: intentionally broken (syntax error)',
  'function render( {',
  '  const tasks = loadTasks(;',
  '  list.innerHTML = "";',
  '}',
  'render();',
].join('\n');

function jsonToolCallLine(name, args) {
  return JSON.stringify({ name, arguments: args });
}

/** The Quillix tool-call contract envelope: {"tool": ..., "arguments": {...}} */
function jsonEnvelopeLine(name, args) {
  return JSON.stringify({ tool: name, arguments: args });
}

const TEST_HTML_CONTENT = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="UTF-8">',
  '  <title>Test Page</title>',
  '</head>',
  '<body>',
  '  <h1>Simple HTML Page</h1>',
  '  <p>Created by the Quillix agent through the file_write tool contract.</p>',
  '</body>',
  '</html>',
].join('\n');

const CALCULATOR_FILES = {
  'index.html': [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '  <title>Calculator</title>',
    '  <link rel="stylesheet" href="style.css">',
    '</head>',
    '<body>',
    '  <main class="calc">',
    '    <input id="display" readonly aria-label="display">',
    '    <div id="keys"></div>',
    '  </main>',
    '  <script src="script.js"></script>',
    '</body>',
    '</html>',
  ].join('\n'),
  'style.css': [
    'body { font-family: system-ui, sans-serif; background: #f4f5f7; margin: 0; }',
    '.calc { max-width: 320px; margin: 2rem auto; padding: 1rem; }',
    '#display { width: 100%; font-size: 1.5rem; padding: .5rem; }',
    '#keys { display: grid; grid-template-columns: repeat(4, 1fr); gap: .5rem; }',
    'button { font-size: 1.1rem; padding: .75rem; }',
  ].join('\n'),
  'script.js': [
    "const keys = document.getElementById('keys');",
    "const display = document.getElementById('display');",
    "let expr = '';",
    "for (const k of ['7','8','9','/','4','5','6','*','1','2','3','-','0','.','=','+']) {",
    "  const b = document.createElement('button');",
    "  b.textContent = k;",
    "  b.addEventListener('click', () => {",
    "    if (k === '=') { try { expr = String(eval(expr)); } catch { expr = 'Error'; } }",
    "    else expr += k;",
    "    display.value = expr;",
    "  });",
    "  keys.appendChild(b);",
    "}",
    "console.log('calculator ready');",
  ].join('\n'),
};

const CAR_GAME_BROKEN = [
  '# CarGame - pygame racing demo (BROKEN on purpose: runtime error)',
  'import pygame',
  '',
  '',
  'def main():',
  '    pygame.init()',
  "    screen = pygame.display.set_mode((400, 300))",
  "    print('car game starting')",
  '',
  '',
  "if __name__ == '__main__':",
  '    main()',
].join('\n');

const CAR_GAME_FIXED = [
  '# CarGame - a tiny terminal racing demo (stdlib only).',
  'import random',
  '',
  '',
  'def main():',
  "    print('CAR GAME')",
  "    print('Steer with A/D. Dodge the obstacles!')",
  '    score = 0',
  "    road = ['.'] * 20",
  '    for tick in range(3):',
  "        road[random.randint(0, 19)] = 'X'",
  "        print(''.join(road))",
  '        score += 10',
  "    print(f'Game over. Score: {score}')",
  '',
  '',
  "if __name__ == '__main__':",
  '    main()',
].join('\n');

// ===== Next-gen e2e scenarios (Python calculator, Node app, bug fix) =====

const PYTHON_CALC_FILES = {
  'calculator.py': [
    '# Python Calculator - a small expression evaluator (stdlib only).',
    'import operator',
    '',
    'OPERATORS = {',
    "    '+': operator.add,",
    "    '-': operator.sub,",
    "    '*': operator.mul,",
    "    '/': operator.truediv,",
    '}',
    '',
    '',
    'def calculate(expression):',
    "    tokens = expression.split()",
    '    a, op, b = float(tokens[0]), tokens[1], float(tokens[2])',
    '    if op not in OPERATORS:',
    "        raise ValueError(f'Unknown operator: {op}')",
    '    return OPERATORS[op](a, b)',
    '',
    '',
    'def main():',
    "    print('Python Calculator')",
    "    for expression in ['2 + 3', '10 - 4', '6 * 7', '8 / 2']:",
    '        try:',
    "            print(f'{expression} = {calculate(expression)}')",
    '        except Exception as err:',
    "            print(f'{expression} -> error: {err}')",
    '',
    '',
    "if __name__ == '__main__':",
    '    main()',
  ].join('\n'),
  'requirements.txt': '# No external dependencies - the calculator uses the Python standard library only.\n',
  'README.md': [
    '# Python Calculator',
    '',
    'A small command-line calculator built by the Quillix agent.',
    '',
    'Run it with:',
    '',
    '    python calculator.py',
    '',
    'Supports the four basic arithmetic operations on simple expressions.',
  ].join('\n'),
};

const NODE_APP_FILES = {
  'package.json': [
    '{',
    '  "name": "notes-app",',
    '  "version": "1.0.0",',
    '  "description": "A small Node.js notes application built by the Quillix agent",',
    '  "main": "index.js",',
    '  "scripts": {',
    '    "start": "node index.js"',
    '  }',
    '}',
  ].join('\n'),
  'index.js': [
    '// Notes App - a small Node.js CLI application (no dependencies).',
    "const args = process.argv.slice(2);",
    '',
    'const DEFAULT_NOTES = [',
    "  'Learn Node.js fundamentals',",
    "  'Build something real with Quillix',",
    "  'Verify the result actually runs',",
    '];',
    '',
    'function main() {',
    "  console.log('Notes App');",
    "  console.log('=========');",
    '  const notes = args.length ? args : DEFAULT_NOTES;',
    '  notes.forEach((note, i) => {',
    "    console.log(`${i + 1}. ${note}`);",
    '  });',
    "  console.log(`Total notes: ${notes.length}`);",
    '}',
    '',
    'main();',
  ].join('\n'),
  'README.md': [
    '# Notes App',
    '',
    'A small Node.js application built by the Quillix agent.',
    '',
    'Run it with:',
    '',
    '    npm start',
  ].join('\n'),
};

// Broken source the e2e harness writes BEFORE asking the agent to fix it.
const BROKEN_PY_APP = [
  '# BrokenApp - intentionally broken (syntax errors).',
  'def greet(name:',
  '    return "Hello, " + name',
  '',
  "if __name__ == '__main__':",
  '    print(greet("World")',
].join('\n');

const FIXED_PY_APP = [
  '# BrokenApp - fixed by the Quillix agent.',
  'def greet(name):',
  '    return "Hello, " + name',
  '',
  "if __name__ == '__main__':",
  '    print(greet("World"))',
].join('\n');

/** Extracts the absolute path reported by a Quillix tool result. */
function absolutePathFromToolResults(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'tool' && typeof m.content === 'string') {
      const hit = m.content.match(/absolute path: (.+)/);
      if (hit) return hit[1].trim();
    }
  }
  return null;
}

function fileArgs(filePath, content) {
  return JSON.parse(JSON.stringify({ filePath, content }));
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/tags') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ models: [{ name: 'qwen2.5-coder:3b' }] }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      chatCallCount++;
      let requestBody = {};
      try { requestBody = JSON.parse(body); } catch { /* invalid requests are handled by the real provider */ }
      const streamResponse = requestBody.stream !== false;
      const bufferedChunks = [];

      // --- Stateless turn detection from the conversation itself ---
      const messages = Array.isArray(requestBody.messages) ? requestBody.messages : [];
      const last = messages[messages.length - 1] || {};
      const userText = messages
        .filter((m) => m.role === 'user')
        .map((m) => (typeof m.content === 'string' ? m.content : ''))
        .join('\n');

      // Deterministically interrupt only after the test file has been written
      // and returned as a tool result. This exercises the persisted-task
      // recovery path without timing-dependent network failures.
      if (userText.includes('checkpoint recovery scenario') && messages.some(message => message.role === 'tool')) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'simulated provider outage after checkpoint' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': streamResponse ? 'application/x-ndjson' : 'application/json' });
      const sendChunk = (obj) => {
        if (streamResponse) res.write(JSON.stringify(obj) + '\n');
        else bufferedChunks.push(obj);
      };
      const sendContent = (text) => sendChunk({ message: { content: text }, done: false });
      const sendToolCall = (name, args) =>
        sendChunk({ message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] }, done: false });

      const isTestHtmlScenario = userText.includes('test.html');
      const isSelectedCssFollowUp = /(?:improve the selected stylesheet for mobile|mobile friendly)/i.test(userText);
      const isPythonCalcScenario =
        !isTestHtmlScenario && /python\s+calculator/i.test(userText);
      const isNodeAppScenario =
        !isTestHtmlScenario && !isPythonCalcScenario && /node\.?js\s+(application|app|project)/i.test(userText);
      const isFixProjectScenario =
        !isTestHtmlScenario && !isPythonCalcScenario && !isNodeAppScenario &&
        userText.includes('BrokenApp');
      const isCalculatorScenario =
        !isTestHtmlScenario && !isPythonCalcScenario && !isNodeAppScenario && !isFixProjectScenario &&
        /calculator/i.test(userText);
      const isCalculatorContinuation =
        isCalculatorScenario && /(?:percentage|percent|existing|same)\b/i.test(userText);
      const isCarGameScenario =
        !isTestHtmlScenario && !isCalculatorScenario && /car game/i.test(userText);
      const isTodoScenario =
        !isTestHtmlScenario && !isCalculatorScenario && !isCarGameScenario &&
        userText.includes('To-Do List web application');
      const hasExistingFileFailure = messages.some((message) =>
        typeof message?.content === 'string' && message.content.includes('File already exists')
      );
      const isRepairRequest = messages.some((message) =>
        typeof message?.content === 'string' && message.content.includes('AUTOMATIC VALIDATION FAILED')
      ) || hasExistingFileFailure;
      const isAcceptance =
        isTestHtmlScenario || isSelectedCssFollowUp || isCalculatorScenario || isCarGameScenario || isTodoScenario ||
        isPythonCalcScenario || isNodeAppScenario || isFixProjectScenario || isRepairRequest;
      const isRuntimeFailure = messages.some((message) =>
        typeof message?.content === 'string' && message.content.includes('EXECUTION FAILED')
      );
      const hasBrokenSource = messages.some((message) =>
        message?.role === 'tool' && typeof message.content === 'string' && message.content.includes('def greet(name:')
      );
      const hasFirstFixResult = messages.some((message) =>
        typeof message?.content === 'string' && message.content.includes('replaced 1 occurrence')
      );
      const isFollowUpToolResult = last.role === 'tool';
      if (!isAcceptance) {
        // Plain conversational reply (normal chat mode).
        sendContent('Hello! I am Quillix, your local coding agent. How can I help today?');
      } else if (isSelectedCssFollowUp && isFollowUpToolResult) {
        sendContent('Updated the selected stylesheet for mobile and kept the CSS source in the workspace.');
      } else if (isSelectedCssFollowUp) {
        sendContent('Applying a responsive update to the selected stylesheet.\n');
        sendToolCall('write_file', fileArgs('style.css', '.panel { width: min(100% - 2rem, 56rem); margin-inline: auto; }\n@media (max-width: 600px) { .panel { width: auto; margin-inline: 1rem; } }\n'));
      } else if (isTestHtmlScenario && isFollowUpToolResult) {
        // Final reply after the tool result — echo the REAL absolute path
        // that Quillix reported back, like a well-behaved model.
        const abs = absolutePathFromToolResults(messages);
        sendContent(
          abs
            ? `Done. The file was created successfully at ${abs}`
            : 'Done. The file was created successfully.'
        );
      } else if (isPythonCalcScenario && isFollowUpToolResult) {
        sendContent('The Python calculator is complete: calculator.py, requirements.txt and README.md are on disk and the program ran successfully.');
      } else if (isPythonCalcScenario) {
        sendContent('Creating the Python calculator project now.\n');
        sendToolCall('create_file', fileArgs('calculator.py', PYTHON_CALC_FILES['calculator.py']));
        sendToolCall('create_file', fileArgs('requirements.txt', PYTHON_CALC_FILES['requirements.txt']));
        sendToolCall('create_file', fileArgs('README.md', PYTHON_CALC_FILES['README.md']));
      } else if (isNodeAppScenario && isFollowUpToolResult) {
        sendContent('The Node.js application is complete: package.json, index.js and README.md are on disk and npm start ran successfully.');
      } else if (isNodeAppScenario) {
        sendContent('Creating the Node.js application now.\n');
        sendToolCall('create_file', fileArgs('package.json', NODE_APP_FILES['package.json']));
        sendToolCall('create_file', fileArgs('index.js', NODE_APP_FILES['index.js']));
        sendToolCall('create_file', fileArgs('README.md', NODE_APP_FILES['README.md']));
      } else if (isFixProjectScenario && last.role === 'tool' && typeof last.content === 'string' && last.content.includes('Exit Code')) {
        sendContent('The project is fixed: both syntax errors were patched, py_compile passes, and the file runs correctly.');
      } else if (isFixProjectScenario && hasFirstFixResult) {
        // The first edit was applied — fix the second error and verify for real.
        sendContent('Applying the second fix and verifying with py_compile.\n');
        sendToolCall('edit_file', { filePath: 'main.py', oldString: 'print(greet("World")', newString: 'print(greet("World"))' });
        sendToolCall('run_command', { command: 'python3 -m py_compile "main.py"' });
      } else if (isFixProjectScenario && hasBrokenSource) {
        // We just READ the real broken source — apply the first minimal edit.
        sendContent('Found a syntax error: an unclosed parameter list. Fixing now.\n');
        sendToolCall('edit_file', { filePath: 'main.py', oldString: 'def greet(name:', newString: 'def greet(name):' });
      } else if (isFixProjectScenario && last.role === 'user') {
        // FIRST turn: inspect before modifying (§13) — read the broken source.
        sendContent('Let me inspect the broken project first.\n');
        sendToolCall('read_file', { filePath: 'BrokenApp/main.py' });
      } else if (isCalculatorContinuation && isFollowUpToolResult) {
        sendContent('The existing Calculator project was updated: the percentage button is connected in script.js and the project remains runnable.');
      } else if (isCalculatorContinuation) {
        sendContent('I found the existing Calculator project and will add the percentage control in place.\n');
        sendToolCall('edit_file', {
          filePath: 'script.js',
          oldString: "for (const k of ['7','8','9','/','4','5','6','*','1','2','3','-','0','.','=','+']) {",
          newString: "for (const k of ['7','8','9','/','4','5','6','*','1','2','3','-','0','.','=','+','%']) {",
        });
      } else if (isCalculatorScenario && isFollowUpToolResult) {
        sendContent('The calculator project is complete: index.html, style.css and script.js are connected.');
      } else if (isTestHtmlScenario) {
        // FIRST turn — the mandated {"tool": "file_write", "arguments": {...}}
        // envelope with a "path" argument (exercises the alias contract).
        sendContent('I will create the file now.\n');
        sendContent(jsonEnvelopeLine('file_write', { path: 'test.html', content: TEST_HTML_CONTENT }) + '\n');
      } else if (isCalculatorScenario) {
        sendContent('Building the calculator project.\n');
        sendContent(jsonToolCallLine('create_file', fileArgs('index.html', CALCULATOR_FILES['index.html'])) + '\n');
        sendContent(jsonToolCallLine('create_file', fileArgs('style.css', CALCULATOR_FILES['style.css'])) + '\n');
        sendContent(jsonToolCallLine('create_file', fileArgs('script.js', CALCULATOR_FILES['script.js'])) + '\n');
        sendContent('All three calculator files created.');
      } else if (isCarGameScenario && last.role === 'user' && typeof last.content === 'string' && last.content.includes('hands-on coding task')) {
        // The engine nudged us to actually USE tools after a conversational
        // first turn - now create the project (with a REAL runtime error:
        // pygame is not installed, so the python runner will fail).
        sendContent('Understood, creating the files now.\n');
        sendContent(jsonToolCallLine('create_file', fileArgs('main.py', CAR_GAME_BROKEN)) + '\n');
        sendContent(jsonToolCallLine('create_file', fileArgs('README.md', '# CarGame\n\nA Python car game. Run with: python main.py\n')) + '\n');
      } else if (isCarGameScenario && isRuntimeFailure) {
        // Real runtime error came back through the tool result - fix it.
        sendContent('The failure is the pygame dependency. Rewriting main.py with a stdlib-only implementation.\n');
        sendToolCall('write_file', fileArgs('main.py', CAR_GAME_FIXED));
      } else if (isCarGameScenario && isFollowUpToolResult) {
        sendContent('The CarGame project is complete. main.py was executed successfully by the Python runner.');
      } else if (isCarGameScenario) {
        // FIRST turn - model explains instead of building (small-model behaviour).
        sendContent(
          "I'd be happy to help you build a car game using Python! Here's how you could approach it: " +
            'you could use the pygame library, create a Game class, and run an update loop that moves ' +
            'the player car and obstacles...'
        );
      } else if (isRepairRequest) {
        // Repair turn triggered by Quillix's automatic validation failure:
        // the model uses the NATIVE tool_calls format (mixed coverage).
        sendContent('The validation error was a syntax mistake in app.js. Fixing it now.\n');
        sendToolCall('write_file', fileArgs('app.js', FILES['app.js']));
      } else if (isFollowUpToolResult) {
        // Final-looking reply with a HUGE code dump that chat must hide.
        sendContent('The project is ready. Here is the HTML:\n');
        sendContent('```html\n' + FILES['index.html'] + '\n```\n');
        sendContent('Everything is in the workspace.');
      } else {
        // FIRST turn of the acceptance run: THE BUG SCENARIO —
        // the model writes tool calls as plain text.
        sendContent('I will create the To-Do List project files now.\n');
        sendContent(jsonToolCallLine('create_file', fileArgs('index.html', FILES['index.html'])) + '\n');
        sendContent(jsonToolCallLine('create_file', fileArgs('style.css', FILES['style.css'])) + '\n');
        sendContent(jsonToolCallLine('create_file', fileArgs('app.js', BROKEN_APP_JS)) + '\n');
        sendContent(jsonToolCallLine('create_file', fileArgs('script.js', FILES['app.js'])) + '\n');
        sendContent(jsonToolCallLine('create_file', fileArgs('README.md', '# To-Do List\n\nA professional responsive To-Do List web application.\n')) + '\n');
        sendContent('All four files created.');
      }

      if (streamResponse) {
        res.write(JSON.stringify({ message: { content: '' }, done: true }) + '\n');
        res.end();
      } else {
        const content = bufferedChunks.map(chunk => chunk.message?.content || '').join('');
        const toolCalls = bufferedChunks.flatMap(chunk => chunk.message?.tool_calls || []);
        res.end(JSON.stringify({ message: { content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, done: true }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

const mockPort = Number(process.env.QUILLIX_MOCK_OLLAMA_PORT || 11499);
server.listen(mockPort, '127.0.0.1', () => {
  console.log(`MOCK OLLAMA listening on 127.0.0.1:${mockPort}`);
});
