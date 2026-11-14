import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { TerminalService } from './terminal.js';

interface GitResult { exitCode: number; stdout: string; stderr: string }

/** Shell-free Git execution prevents quote, shell substitution and metacharacter injection. */
async function executeGit(cwd: string, args: string[], timeoutMs = 30000): Promise<GitResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let finished = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: GitResult) => {
      if (finished) return;
      finished = true;
      if (timeout) clearTimeout(timeout);
      resolve(result);
    };
    let child;
    try {
      child = spawn('git', args, { cwd, shell: false, windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } });
    } catch (err: any) {
      return finish({ exitCode: 1, stdout, stderr: String(err?.message || err) });
    }
    timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ exitCode: 124, stdout, stderr: `${stderr}\nGit timed out after ${timeoutMs / 1000}s.` });
    }, timeoutMs);
    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString('utf8'); if (stdout.length > 500000) stdout = stdout.slice(-250000); });
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString('utf8'); if (stderr.length > 500000) stderr = stderr.slice(-250000); });
    child.once('error', (err) => finish({ exitCode: 1, stdout, stderr: `${stderr}\n${err.message}` }));
    child.once('close', (code) => finish({ exitCode: code ?? 1, stdout, stderr }));
  });
}

function validateGitPath(cwd: string, value: string): string | null {
  if (value === '.') return '.';
  if (!value || typeof value !== 'string' || value.includes('\0') || value.startsWith(':')) return null;
  if (path.isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value)) return null;
  const root = path.resolve(cwd);
  const resolved = path.resolve(root, value);
  const rel = path.relative(root, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  try {
    const realRoot = fs.realpathSync(root);
    let ancestor = resolved;
    while (!fs.existsSync(ancestor) && ancestor !== path.dirname(ancestor)) ancestor = path.dirname(ancestor);
    const realAncestor = fs.realpathSync(ancestor);
    if (realAncestor !== realRoot && !realAncestor.startsWith(realRoot + path.sep)) return null;
  } catch { return null; }
  return rel.replace(/\\/g, '/');
}

export class GitService {
  // Kept for backward compatibility with callers that construct GitService(terminal).
  constructor(_terminalService: TerminalService) {}

  public async isGitRepo(cwd: string): Promise<boolean> {
    const res = await executeGit(cwd, ['rev-parse', '--is-inside-work-tree']);
    return res.exitCode === 0 && res.stdout.trim() === 'true';
  }

  public async getBranch(cwd: string): Promise<string> {
    const res = await executeGit(cwd, ['branch', '--show-current']);
    if (res.exitCode === 0 && res.stdout.trim()) return res.stdout.trim();
    const head = await executeGit(cwd, ['rev-parse', '--short', 'HEAD']);
    return head.exitCode === 0 ? head.stdout.trim() : '';
  }

  public async getStatus(cwd: string): Promise<{
    isGit: boolean;
    branch: string;
    files: Array<{ path: string; status: 'modified' | 'staged' | 'untracked' | 'deleted'; rawStatus: string }>;
    raw: string;
  }> {
    if (!await this.isGitRepo(cwd)) return { isGit: false, branch: '', files: [], raw: 'Not a git repository' };
    const branch = await this.getBranch(cwd);
    const res = await executeGit(cwd, ['status', '--porcelain', '-z']);
    const files: Array<{ path: string; status: 'modified' | 'staged' | 'untracked' | 'deleted'; rawStatus: string }> = [];
    if (res.exitCode === 0) {
      const pieces = res.stdout.split('\0');
      for (let i = 0; i < pieces.length; i++) {
        const entry = pieces[i];
        if (!entry || entry.length < 4) continue;
        const code = entry.slice(0, 2);
        const filePath = entry.slice(3);
        // Renames/copies include a second NUL-separated pathname (the source).
        if (code.includes('R') || code.includes('C')) i++;
        const status = code === '??' ? 'untracked'
          : code.includes('D') ? 'deleted'
          : code[0] !== ' ' && code[0] !== '?' ? 'staged' : 'modified';
        files.push({ path: filePath, status, rawStatus: code });
      }
    }
    return { isGit: true, branch, files, raw: files.map(f => `${f.rawStatus} ${f.path}`).join('\n') };
  }

  public async getDiff(cwd: string, staged = false): Promise<string> {
    const res = await executeGit(cwd, staged ? ['diff', '--cached'] : ['diff']);
    return res.stdout;
  }

  public async getLog(cwd: string, limit = 10): Promise<Array<{ hash: string; author: string; date: string; message: string }>> {
    const count = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit))) : 10;
    const res = await executeGit(cwd, ['log', '-n', String(count), '--pretty=format:%h|%an|%ar|%s']);
    if (res.exitCode !== 0) return [];
    return res.stdout.split('\n').filter(Boolean).map(line => {
      const [hash, author, date, ...message] = line.split('|');
      return { hash: hash || '', author: author || '', date: date || '', message: message.join('|') };
    });
  }

  /**
   * M1.6: search across git history — `git log -p | grep` as a first-class
   * query. The term is escaped so it always matches literally, results are
   * bounded, and the commit list carries the files each commit touched.
   */
  public async searchHistory(cwd: string, query: string, options: { limit?: number } = {}): Promise<{
    isGit: boolean;
    query: string;
    commits: Array<{ hash: string; author: string; date: string; subject: string; files: string[] }>;
  }> {
    const term = typeof query === 'string' ? query.trim() : '';
    const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(100, Math.trunc(options.limit as number))) : 30;
    if (!term) return { isGit: await this.isGitRepo(cwd), query: '', commits: [] };
    if (!(await this.isGitRepo(cwd))) return { isGit: false, query: term, commits: [] };
    // -G matches commits whose diff adds/removes a line containing the term.
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const res = await executeGit(cwd, ['log', '-n', String(limit), '--name-only', '--no-renames', '--format=%H%x1f%an%x1f%ar%x1f%s', `-G${escaped}`]);
    const commits: Array<{ hash: string; author: string; date: string; subject: string; files: string[] }> = [];
    if (res.exitCode === 0) {
      let current: { hash: string; author: string; date: string; subject: string; files: string[] } | null = null;
      for (const line of res.stdout.split('\n')) {
        if (!line.trim()) continue;
        if (line.includes('\u001f')) {
          const [hash, author, date, ...subject] = line.split('\u001f');
          current = { hash: hash || '', author: author || '', date: date || '', subject: subject.join('\u001f'), files: [] };
          commits.push(current);
        } else if (current) {
          current.files.push(line.trim());
        }
      }
    }
    return { isGit: true, query: term, commits };
  }

  public async add(cwd: string, filePath = '.'): Promise<{ success: boolean; output: string }> {
    const safe = validateGitPath(cwd, filePath);
    if (safe === null) return { success: false, output: 'Git staging blocked: path is outside the active workspace or is unsafe.' };
    const res = await executeGit(cwd, ['add', '--', safe]);
    return { success: res.exitCode === 0, output: res.stdout || res.stderr };
  }

  public async commit(cwd: string, message: string): Promise<{ success: boolean; output: string }> {
    if (!message?.trim()) return { success: false, output: 'Commit message is required.' };
    const res = await executeGit(cwd, ['commit', '-m', message]);
    return { success: res.exitCode === 0, output: res.stdout || res.stderr };
  }

  public async checkout(cwd: string, target: string, isNew = false): Promise<{ success: boolean; output: string }> {
    if (!target || target.startsWith('-') || target.includes('\0')) return { success: false, output: 'Invalid branch name.' };
    const res = await executeGit(cwd, isNew ? ['switch', '-c', target] : ['switch', target]);
    return { success: res.exitCode === 0, output: res.stdout || res.stderr };
  }

  /** Local branch names (no remotes) plus a hit for the current checkout. */
  public async listBranches(cwd: string): Promise<Array<{ name: string; current: boolean }>> {
    const res = await executeGit(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
    if (res.exitCode !== 0) return [];
    const names = res.stdout.split('\n').map(s => s.trim()).filter(Boolean);
    const current = await this.getBranch(cwd);
    return names.map(name => ({ name, current: name === current }));
  }

  public async hasBranch(cwd: string, name: string): Promise<boolean> {
    if (!name || name.startsWith('-')) return false;
    const res = await executeGit(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]);
    return res.exitCode === 0;
  }

  /** Merge a branch back into the current one with a real merge commit. */
  public async mergeBranch(cwd: string, name: string, message: string): Promise<{ success: boolean; output: string; conflict?: boolean }> {
    if (!name || name.startsWith('-') || name.includes('\0')) return { success: false, output: 'Invalid branch name.' };
    const res = await executeGit(cwd, ['merge', '--no-ff', name, '-m', message || `Merge ${name}`]);
    const output = res.stdout || res.stderr;
    return { success: res.exitCode === 0, output, conflict: res.exitCode !== 0 && /conflict/i.test(output) };
  }

  public async deleteBranch(cwd: string, name: string, force = true): Promise<{ success: boolean; output: string }> {
    if (!name || name.startsWith('-') || name.includes('\0')) return { success: false, output: 'Invalid branch name.' };
    const res = await executeGit(cwd, ['branch', force ? '-D' : '-d', name]);
    return { success: res.exitCode === 0, output: res.stdout || res.stderr };
  }

  /** Throw away every uncommitted change in the working tree (destructive).
   *  Untracked files the task created are removed too; ignored files stay. */
  public async discardWorkingChanges(cwd: string): Promise<{ success: boolean; output: string }> {
    const reset = await executeGit(cwd, ['reset', '--hard']);
    const clean = await executeGit(cwd, ['clean', '-fd']);
    const output = `${reset.stdout || reset.stderr}\n${clean.stdout || clean.stderr}`.trim();
    return { success: reset.exitCode === 0 && clean.exitCode === 0, output };
  }

  public async restore(cwd: string, filePath: string): Promise<{ success: boolean; output: string }> {
    const safe = validateGitPath(cwd, filePath);
    if (safe === null) return { success: false, output: 'Git restore blocked: path is outside the active workspace or is unsafe.' };
    const res = await executeGit(cwd, ['restore', '--', safe]);
    return { success: res.exitCode === 0, output: res.stdout || res.stderr };
  }
}
