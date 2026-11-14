import fs from 'node:fs';
import path from 'node:path';
import { AgentEngine } from '../../src/server/agentEngine.js';
import { OllamaQwenProvider } from '../../src/server/qwen.js';
import { WorkspaceManager } from '../../src/server/workspace.js';
import { TerminalService } from '../../src/server/terminal.js';
import { GitService } from '../../src/server/git.js';
import { CodebaseIndexer } from '../../src/server/indexer.js';
import { ToolRegistry } from '../../src/server/toolRegistry.js';
import { SettingsStore } from '../../src/server/settings.js';
import { WorkspaceVerifier } from '../../src/server/verifier.js';

const workspaceRoot = path.resolve(process.env.SMOKE_ROOT || 'test/qwen-ecommerce-Pg5jxx');
const finalOnly = process.env.SMOKE_FINAL_ONLY === '1';
const prompt = finalOnly
  ? `Repair only the final two acceptance failures in the existing AURA project. Do not create another folder and do not redesign working behavior. Use exactly one write_file call for AURA/index.html.

The verifier failures are: HTML contains placeholder/empty sections or product-card comments, and the linked AURA/script.js uses the CSS class .remove-from-cart which is absent from the HTML. Replace the complete index.html with valid markup that preserves the existing style.css and script.js links, keeps the six product cards and cart IDs, removes every TODO/here/placeholder/lorem-ipsum comment or empty section, and includes a real .remove-from-cart element or template matching the script. Do not paste code in chat; write the file and let NUVRO AI verify it.`
  : `Repair the existing AURA project in this workspace. Do not create another project folder and do not merely explain the fix.

The current acceptance failures are concrete: index.html has placeholder comments and empty product cards; script.js references missing search-input, category-select, cart-list, subtotal, add-to-cart-btn and remove-from-cart-btn DOM contracts; style.css has no real :focus or :focus-visible selector. Repair the files in place with tools.

The final AURA folder must contain exactly these working root files: index.html, style.css and script.js. Make the implementation coherent across all three files: visible luxury animated e-commerce UI, six real product cards with product-1 through product-6, a search input with id search-input, category select with id category-select, add-to-cart-btn controls, cart-list and subtotal, remove-from-cart-btn controls for rendered cart items, cart count, quantity changes, checkout feedback, and localStorage persistence. Use correct relative links, no placeholder/TODO comments, no script tags inside script.js, and a real keyboard focus-visible style. Keep the existing dark premium aesthetic and responsive/reduced-motion CSS.

Use the available file tools to write the actual files and inspect them before finishing. Do not paste a proposed solution into chat; make the changes on disk.`;

async function main() {
  const ai = new OllamaQwenProvider({ model: process.env.OLLAMA_MODEL || 'qwen2.5-coder:3b' });
  const status = await ai.getStatus();
  if (!status.connected || !status.modelAvailable) throw new Error(status.details);
  await ai.warmUp(status.model);
  const ws = new WorkspaceManager(workspaceRoot);
  const terminal = new TerminalService();
  const git = new GitService(terminal);
  const indexer = new CodebaseIndexer(ws, git);
  const settings = new SettingsStore(path.join(workspaceRoot, '.quillix', 'repair-settings.json'));
  const saved = settings.update({ aiProvider: 'ollama', model: status.model, temperature: 0, autoApplyDiffs: true });
  if (!saved.success) throw new Error(saved.error);
  const verifier = new WorkspaceVerifier(ws, terminal);
  const engine = new AgentEngine(ai, new ToolRegistry(ws, terminal, git, indexer, settings), indexer, verifier);
  console.log(`Model: ${status.model}\nWorkspace: ${workspaceRoot}`);
  const result = await engine.run({
    userPrompt: prompt,
    mode: 'agent',
    conversationHistory: [],
    model: status.model,
    settings: { maxAutonomousTurns: finalOnly ? 4 : 6, temperature: 0, autoApplyDiffs: true },
    // CPU-only Ollama models can spend several minutes on a first tool turn
    // and another bounded turn on verifier-driven repair. Keep the benchmark
    // finite, but do not fail a valid offline run because of an artificial
    // six-minute ceiling. CI/users can override this per machine.
    signal: AbortSignal.timeout(Math.max(2, Number(process.env.SMOKE_TIMEOUT_MINUTES || 15)) * 60_000),
    onActivity: activity => console.log(`[${activity.type}] ${activity.message}`),
  });
  const checks = await verifier.verifyFiles(result.verifiedFiles, prompt);
  const projectRoot = path.join(workspaceRoot, 'AURA');
  const files = ['index.html', 'style.css', 'script.js'].map(file => path.join(projectRoot, file));
  const exists = files.every(file => fs.existsSync(file));
  const contents = files.map(file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '').join('\n');
  const qualitySignals = {
    hasAnimations: /@keyframes|animation\s*:|transition\s*:/i.test(contents),
    hasCart: /cart|addToCart|localStorage/i.test(contents),
    hasFiltering: /filter|search/i.test(contents),
    hasResponsiveCss: /@media/i.test(contents),
    hasReducedMotion: /prefers-reduced-motion/i.test(contents),
    hasSixProducts: (contents.match(/product/gi) || []).length >= 6,
  };
  // A repair task legitimately ends through the report phase rather than the
  // green-field completion phase. Treat it as complete only when the report
  // was emitted and every verifier/file gate is also green; this prevents a
  // bookkeeping false-negative without weakening acceptance.
  const completionPhase = result.phases.find(phase => phase.id === 'completion')?.status === 'completed';
  const reportPhase = result.phases.find(phase => phase.id === 'report')?.status === 'completed';
  const complete = completionPhase || (reportPhase && checks.allOk && exists && result.verifiedFiles.filter(file => /(?:^|[\\/])AURA[\\/]?(?:index\.html|style\.css|script\.js)$/i.test(file)).length >= 3);
  const report = { model: status.model, workspace: workspaceRoot, complete, checks, qualitySignals, result };
  fs.writeFileSync(path.join(workspaceRoot, 'repair-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ complete, allChecksPassed: checks.allOk, exists, files: result.verifiedFiles, qualitySignals, failures: checks.failures }, null, 2));
  if (!complete || !checks.allOk || !exists) process.exitCode = 1;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
