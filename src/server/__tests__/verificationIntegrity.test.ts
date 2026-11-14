import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { WorkspaceVerifier } from '../verifier.js';
import { WorkspaceManager } from '../workspace.js';
import { TerminalService } from '../terminal.js';
import { parseReviewFindings, reviewResponseIsUnparseable } from '../reviewAgent.js';
import { CodebaseIndexer } from '../indexer.js';
import { GitService } from '../git.js';

/**
 * Verification-integrity contract. The agent's completion gate is only honest
 * if every "verified" claim is backed by a real check:
 *
 *  §V1  an UNREADABLE file fails verification — silently skipping the content
 *       checks would let an unverifiable file count toward success.
 *  §V2  an unclosed <script>/<style> is reported by name instead of a
 *       misleading "Tag <x> is never closed" that sends the agent into a
 *       useless repair loop.
 *  §V3  reviewer findings inside a NON-FIRST fenced block are still parsed,
 *       so a review with blockers is never mistaken for a clean review.
 *  §V4  a non-string severity cannot masquerade as a real blocker.
 *  §V5  the active-file context sent to the model is redacted on disk reads
 *       exactly like the unsaved-buffer branch.
 */

describe('verification integrity', () => {
  let testDir: string;
  let workspace: WorkspaceManager;
  let verifier: WorkspaceVerifier;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-verify-integrity-'));
    workspace = new WorkspaceManager(testDir);
    verifier = new WorkspaceVerifier(workspace, new TerminalService());
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  // ------------------------------------------------------------------ §V1 ---

  it('reports an unreadable file as a verification failure, not a silent pass', async () => {
    // A protected secret file: WorkspaceManager refuses to read it, so the
    // verifier must fail it instead of counting existence as success.
    fs.writeFileSync(path.join(testDir, 'credentials.json'), '{"token":"live-secret"}');
    const report = await verifier.verifyFiles(['credentials.json']);
    expect(report.allOk).toBe(false);
    expect(report.failures.some(f => f.check === 'content-read')).toBe(true);
  });

  it('still passes a readable file with a real implementation', async () => {
    fs.writeFileSync(path.join(testDir, 'app.js'), 'const total = (a, b) => a + b;\nmodule.exports = { total };\n');
    const report = await verifier.verifyFiles(['app.js']);
    expect(report.allOk).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it('still rejects placeholder and broken files', async () => {
    fs.writeFileSync(path.join(testDir, 'stub.py'), 'def run():\n    pass\n');
    fs.writeFileSync(path.join(testDir, 'broken.js'), 'const a = ;\n');
    const stub = await verifier.verifyFiles(['stub.py']);
    expect(stub.allOk).toBe(false);
    expect(stub.failures.some(f => f.check === 'placeholder-content')).toBe(true);
    const broken = await verifier.verifyFiles(['broken.js']);
    expect(broken.allOk).toBe(false);
    expect(broken.failures.some(f => f.check === 'js-syntax')).toBe(true);
  });

  // ------------------------------------------------------------------ §V2 ---

  it('names an unclosed <script> instead of blaming an unrelated tag', async () => {
    const html = '<!doctype html><html><body><h1>Game</h1><script>\nconst x = 1;\n</body></html>';
    fs.writeFileSync(path.join(testDir, 'index.html'), html);
    const report = await verifier.verifyFiles(['index.html']);
    expect(report.allOk).toBe(false);
    const htmlFailure = report.failures.find(f => f.check === 'html-balance');
    expect(htmlFailure?.error).toContain('<script>');
    expect(htmlFailure?.error).not.toContain('is never closed before');
  });

  it('accepts a valid page whose JavaScript contains tag-like strings', async () => {
    const html = '<!doctype html><html><body><div id="a"></div><script>\nif (a < b && c > d) {}\nconst s = "<empty>";\n</script></body></html>';
    fs.writeFileSync(path.join(testDir, 'ok.html'), html);
    const report = await verifier.verifyFiles(['ok.html']);
    expect(report.failures.filter(f => f.check === 'html-balance')).toEqual([]);
  });

  // ------------------------------------------------------------------ §V3 ---

  it('parses reviewer findings that arrive in the second fenced block', () => {
    const response = [
      'Here is my analysis of the change:',
      '```',
      'The function returns the wrong value for zero.',
      '```',
      '```json',
      JSON.stringify({ findings: [{ severity: 'blocker', file: 'src/money.cjs', line: 12, issue: 'Division by zero is unguarded' }] }),
      '```',
    ].join('\n');
    const findings = parseReviewFindings(response);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('blocker');
    expect(findings[0].file).toBe('src/money.cjs');
    expect(findings[0].issue).toContain('Division by zero');
  });

  it('still parses a bare JSON body and rejects malformed reviewer output', () => {
    expect(parseReviewFindings(JSON.stringify({ findings: [{ severity: 'major', file: 'a.js', issue: 'Unused import' }] })))
      .toEqual([{ severity: 'major', file: 'a.js', issue: 'Unused import' }]);
    expect(parseReviewFindings('the code looks fine to me')).toEqual([]);
    expect(parseReviewFindings('{"findings": [{"severity":"blocker","file":"../outside.js","issue":"escape"}]}')).toEqual([]);
  });

  // ------------------------------------------------------------------ §V4 ---

  it('rejects a non-string severity instead of trusting String() coercion', () => {
    const findings = parseReviewFindings(JSON.stringify({
      findings: [
        { severity: ['blocker'], file: 'src/a.js', issue: 'array severity' },
        { severity: 'blocker', file: 'src/b.js', issue: 'real blocker' },
      ],
    }));
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('src/b.js');
  });

  // ------------------------------------------------------------------ §V5 ---

  it('does not misclassify an id-only stylesheet as a placeholder', async () => {
    fs.writeFileSync(path.join(testDir, 'theme.css'), '#header { color: red; }\n#footer { color: blue; }\n');
    const report = await verifier.verifyFiles(['theme.css']);
    expect(report.failures.filter(f => f.check === 'placeholder-content')).toEqual([]);
  });

  it('flags async, arrow and class stub-only implementations as placeholders', async () => {
    const stubs: Array<[string, string]> = [
      ['async.cjs', 'async function load() {}\n'],
      ['arrow.cjs', 'const handler = () => {};\n'],
      ['class.py', 'class Service:\n    def run(self):\n        raise NotImplementedError()\n'],
      ['bare.py', 'raise NotImplementedError()\n'],
    ];
    for (const [file, content] of stubs) {
      fs.writeFileSync(path.join(testDir, file), content);
      const report = await verifier.verifyFiles([file]);
      expect(report.failures.some(f => f.check === 'placeholder-content'), `${file} must fail as a stub`).toBe(true);
    }
  });

  it('keeps a real CSS implementation and a real class valid', async () => {
    fs.writeFileSync(path.join(testDir, 'ok.css'), '#app {\n  color: navy;\n}\n.btn:hover { color: red; }\n');
    fs.writeFileSync(path.join(testDir, 'svc.py'), 'class Service:\n    def run(self):\n        return 42\n');
    expect((await verifier.verifyFiles(['ok.css'])).allOk).toBe(true);
    expect((await verifier.verifyFiles(['svc.py'])).failures.filter(f => f.check === 'placeholder-content')).toEqual([]);
  });

  it('distinguishes an unparseable reviewer response from a clean one', () => {
    expect(reviewResponseIsUnparseable('the code looks fine to me')).toBe(true);
    expect(reviewResponseIsUnparseable('{"findings":[{"severity":"blocker"')).toBe(true); // truncated JSON
    expect(reviewResponseIsUnparseable('')).toBe(true);
    expect(reviewResponseIsUnparseable('{"findings":[]}')).toBe(false);
    expect(reviewResponseIsUnparseable('review:\n```json\n{"findings":[{"severity":"minor","file":"a.js","issue":"typo"}]}\n```')).toBe(false);
  });

  it('redacts secrets in the on-disk active-file context sent to the model', async () => {
    fs.writeFileSync(path.join(testDir, 'config.js'), 'const apiKey = "sk-live-1234567890abcdef";\nmodule.exports = { apiKey };\n');
    const indexer = new CodebaseIndexer(workspace, new GitService(new TerminalService()));
    const context = await indexer.getCompressedContext('config.js');
    expect(context).not.toContain('sk-live-1234567890abcdef');
    expect(context).toContain('[REDACTED]');
  });
});