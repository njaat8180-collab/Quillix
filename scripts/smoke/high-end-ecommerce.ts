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

const prompt = `Build a polished, high-end animated e-commerce website called AURA MARKET using only plain HTML, CSS and JavaScript.

File layout is strict: create exactly these three files at the project root: index.html, style.css, script.js. Do not create src, public, components, build or random folders.

Design direction: cinematic streaming-service-quality presentation, but original branding and visuals. Use a dark luxury palette, dramatic gradients, soft glass panels, large editorial typography, product imagery using tasteful remote Unsplash image URLs with descriptive alt text, and Netflix-like cinematic entrance/hover/scroll animations without copying Netflix branding. Make it look like a real premium storefront, not a demo.

Required UI: sticky glass navigation with brand, search field, category links and cart button; animated hero with headline, supporting copy and primary CTA; featured product grid with at least 6 products, category chips and visible prices; product cards with image hover motion, badges and add-to-cart buttons; a cart drawer or modal that lists added items, quantity controls, subtotal and checkout button; search filtering; category filtering; scroll-reveal animations; a newsletter/footer section. Make all buttons and controls actually work in JavaScript, including cart count, add/remove, quantity updates, search and filters. Persist cart in localStorage.

Quality requirements: semantic accessible HTML, viewport meta, visible focus styles, keyboard-friendly controls, responsive mobile layout with a breakpoint, prefers-reduced-motion support, polished spacing/typography/color hierarchy, no lorem ipsum, no dead buttons, no inline script or inline style, and no external libraries. Keep the implementation reasonably sized but complete. Before finishing, inspect all three files and run validation. Write the files with tools, do not merely paste code into chat.`;

const timeoutMs = Number(process.env.QUILLIX_HIGH_END_TIMEOUT_MS || 12 * 60_000);
if (!Number.isFinite(timeoutMs) || timeoutMs < 60_000 || timeoutMs > 30 * 60_000) {
  throw new Error('High-end benchmark timeout must be 60000–1800000 ms.');
}

async function main() {
  const ai = new OllamaQwenProvider({ model: process.env.OLLAMA_MODEL || 'qwen2.5-coder:3b' });
  const status = await ai.getStatus();
  if (!status.connected || !status.modelAvailable) throw new Error(status.details);
  await ai.warmUp(status.model);

  const parent = path.resolve('test');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'qwen-ecommerce-'));
  let result: Awaited<ReturnType<AgentEngine['run']>> | undefined;
  const startedAt = Date.now();
  const writeReport = (extra: Record<string, unknown> = {}) => {
    const projectFolder = result?.verifiedFiles
      .map(file => file.split(/[\\/]/)[0])
      .find(Boolean)
      || fs.readdirSync(root, { withFileTypes: true }).find(entry => entry.isDirectory() && entry.name !== '.quillix')?.name;
    const projectRoot = projectFolder ? path.join(root, projectFolder) : root;
    const files = ['index.html', 'style.css', 'script.js'].map(file => path.join(projectRoot, file));
    const contents = files.map(file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '').join('\n');
    const qualitySignals = {
      hasAnimations: /@keyframes|animation\s*:|transition\s*:/i.test(contents),
      hasCart: /cart|addToCart|localStorage/i.test(contents),
      hasFiltering: /filter|search/i.test(contents),
      hasResponsiveCss: /@media/i.test(contents),
      hasReducedMotion: /prefers-reduced-motion/i.test(contents),
      hasSixProducts: (contents.match(/product/gi) || []).length >= 6,
    };
    fs.writeFileSync(path.join(root, 'acceptance-report.json'), JSON.stringify({
      model: status.model,
      workspace: root,
      elapsedMs: Date.now() - startedAt,
      projectFolder,
      files: files.map(file => ({ file, exists: fs.existsSync(file), bytes: fs.existsSync(file) ? fs.statSync(file).size : 0 })),
      complete: result?.phases.find(phase => phase.id === 'completion')?.status === 'completed' || false,
      qualitySignals,
      result: result || null,
      ...extra,
    }, null, 2));
    return { projectFolder, files, qualitySignals };
  };

  try {
    const ws = new WorkspaceManager(root);
    const terminal = new TerminalService();
    const git = new GitService(terminal);
    const indexer = new CodebaseIndexer(ws, git);
    const settings = new SettingsStore(path.join(root, '.quillix', 'smoke-settings.json'));
    const saved = settings.update({ aiProvider: 'ollama', model: status.model, temperature: 0, autoApplyDiffs: true });
    if (!saved.success) throw new Error(saved.error);
    const verifier = new WorkspaceVerifier(ws, terminal);
    const engine = new AgentEngine(ai, new ToolRegistry(ws, terminal, git, indexer, settings), indexer, verifier);

    console.log(`Model: ${status.model}\nWorkspace: ${root}`);
    result = await engine.run({
      userPrompt: prompt,
      mode: 'agent',
      conversationHistory: [],
      model: status.model,
      settings: { maxAutonomousTurns: 14, temperature: 0, autoApplyDiffs: true },
      signal: AbortSignal.timeout(timeoutMs),
      onActivity: activity => console.log(`[${activity.type}] ${activity.message}`),
    });

    const checks = await verifier.verifyFiles(result.verifiedFiles, prompt);
    const summary = writeReport({ checks });
    const allChecksPassed = checks.allOk && result.verifiedFiles.length >= 3;
    console.log(JSON.stringify({
      complete: result.phases.find(phase => phase.id === 'completion')?.status === 'completed',
      allChecksPassed,
      projectFolder: summary.projectFolder,
      exists: summary.files.every(file => fs.existsSync(file)),
      files: result.verifiedFiles,
      qualitySignals: summary.qualitySignals,
      failures: checks.failures,
    }, null, 2));
    if (!allChecksPassed) process.exitCode = 1;
  } catch (error) {
    const message = String((error as Error)?.message || error);
    const summary = writeReport({ error: message, aborted: /abort|timeout|timed out/i.test(message) });
    console.error(`Benchmark failed after ${Date.now() - startedAt}ms: ${message}`);
    console.error(`Acceptance report: ${path.join(root, 'acceptance-report.json')}`);
    console.error(`Files present: ${summary.files.filter(file => fs.existsSync(file)).map(file => path.basename(file)).join(', ') || 'none'}`);
    process.exitCode = 1;
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
