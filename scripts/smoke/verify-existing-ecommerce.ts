import fs from 'node:fs';
import path from 'node:path';
import { WorkspaceManager } from '../../src/server/workspace.js';
import { TerminalService } from '../../src/server/terminal.js';
import { WorkspaceVerifier } from '../../src/server/verifier.js';

const root = path.resolve(process.env.SMOKE_ROOT || 'test/qwen-ecommerce-WxPTxO');
const project = path.join(root, process.env.SMOKE_PROJECT || 'AURA');
const prompt = 'Build a polished high-end animated responsive e-commerce website with search, category filter, cart, checkout, keyboard accessibility and localStorage persistence.';
const ws = new WorkspaceManager(root);
const verifier = new WorkspaceVerifier(ws, new TerminalService());
const files = ['index.html', 'style.css', 'script.js'].map(file => path.relative(root, path.join(project, file)).replace(/\\/g, '/'));
const report = await verifier.verifyFiles(files, prompt);
const result = { root, project, files, allOk: report.allOk, failures: report.failures };
fs.writeFileSync(path.join(root, 'verification-report.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (!report.allOk) process.exitCode = 1;
