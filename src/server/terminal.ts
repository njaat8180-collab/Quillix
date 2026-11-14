import { spawn, spawnSync, ChildProcess } from 'child_process';
import os from 'os';
import { CommandExecutionResult, CommandRisk, TerminalHistoryEntry } from '../shared/types.js';

const MAX_HISTORY = 100;

function terminateProcess(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000, stdio: 'ignore' });
  } else child.kill('SIGTERM');
}

export class TerminalService {
  private activeProcesses: Map<string, ChildProcess> = new Map();
  /** Rolling log of every command executed through QUILLIX (agent + user). */
  private history: TerminalHistoryEntry[] = [];

  /** Returns the most recent executed commands (newest last). */
  public getHistory(limit = 50): TerminalHistoryEntry[] {
    return this.history.slice(-Math.max(1, limit));
  }

  private recordHistory(entry: TerminalHistoryEntry): void {
    this.history.push(entry);
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(-MAX_HISTORY);
    }
  }

  /**
   * Classify command risk
   */
  public static classifyRisk(command: string): { risk: CommandRisk; reason?: string } {
    const trimmed = command.trim();

    // DANGEROUS
    const dangerousPatterns = [
      /\b(?:rm|rmdir|rd|del|erase|Remove-Item|Clear-Content)\b/i,
      /\bgit\s+(?:reset\s+--hard|clean\b|restore\b)/i,
      /\brm\s+-[rf]{1,2}\b/i,
      /\bRemove-Item\b.*-Recurse/i,
      /\bdel\s+\/[sfq]/i,
      /\bformat\b/i,
      /\bdiskpart\b/i,
      /\bshutdown\b/i,
      /\breg\s+(delete|add)\b/i,
      /\bdd\s+if=/i,
      /\bchmod\s+-R\s+777\b/i,
      /\bmkfs\b/i,
      /\bformat\s+[a-z]:/i,
      /\bdrop\s+(table|database)\b/i,
      />\s*\/dev\/sd[a-z]/i,
    ];

    for (const pat of dangerousPatterns) {
      if (pat.test(trimmed)) {
        return {
          risk: 'DANGEROUS',
          reason: 'Command contains potentially destructive file or system-level deletion/format instructions.',
        };
      }
    }

    // REVIEW: arbitrary interpreters, shell chaining, redirection and inline
    // code can modify any file regardless of command working directory.
    // Never treat these as automatically safe merely because they lack "rm".
    const reviewPatterns = [
      /(?:&&|\|\||[;`]|\$\(|\$\{|\s+[><]\s*[^&])/,
      /\b(?:node|python(?:3)?|ruby|perl|php)\s+(?:-e|-c|--eval)\b/i,
      /\b(?:powershell|pwsh|cmd)(?:\.exe)?\s+[/-](?:c|command|encodedcommand|enc)\b/i,
      /\b(?:curl|wget|Invoke-WebRequest|iwr)\b/i,
      /\bnpm\s+(i|install|uninstall|update)\b/i,
      /\bpnpm\s+(i|install|add|remove)\b/i,
      /\byarn\s+(add|remove)\b/i,
      /\bpip\s+(install|uninstall)\b/i,
      /\bgit\s+(checkout|reset|clean|push|rebase|merge)\b/i,
      /\bmkdir\b/i,
      /\btouch\b/i,
      /\bmv\b/i,
    ];

    for (const pat of reviewPatterns) {
      if (pat.test(trimmed)) {
        return {
          risk: 'REVIEW',
          reason: 'Command alters dependencies, environment state, or git branch tree.',
        };
      }
    }

    // SAFE
    return { risk: 'SAFE' };
  }

  /**
   * Execute command synchronously-buffered with timeout and return result.
   * `source` records who triggered the command ('user' via the terminal
   * panel, 'agent' via the autonomous loop) so the UI can show real activity.
   */
  public async executeCommand(
    command: string,
    cwd: string,
    shellChoice?: 'powershell' | 'cmd' | 'bash' | 'agent',
    timeoutMs = 60000,
    source: 'user' | 'agent' = 'user'
  ): Promise<CommandExecutionResult> {
    const startTime = Date.now();
    const { risk } = TerminalService.classifyRisk(command);

    // 'agent' means: use the OS default shell but tag the run as agent-issued.
    const shellChoiceResolved = shellChoice === 'agent' ? undefined : shellChoice;

    const isWin = os.platform() === 'win32';
    let shell: string | boolean = true;

    if (shellChoiceResolved === 'powershell') {
      shell = isWin ? 'powershell.exe' : 'pwsh';
    } else if (shellChoice === 'cmd') {
      shell = isWin ? 'cmd.exe' : 'bash';
    } else if (shellChoice === 'bash') {
      shell = 'bash';
    }

    return new Promise<CommandExecutionResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      let child: ChildProcess;
      try {
        child = spawn(command, {
          cwd,
          shell,
          env: { ...process.env, FORCE_COLOR: '0', CI: 'true' },
          windowsHide: true,
        });
      } catch (err: any) {
        return resolve({
          command,
          cwd,
          risk,
          stdout: '',
          stderr: `Failed to spawn process: ${err.message}`,
          exitCode: 1,
          durationMs: Date.now() - startTime,
        });
      }

      const procId = `proc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      this.activeProcesses.set(procId, child);

      const timer = setTimeout(() => {
        killed = true;
        try {
          terminateProcess(child);
        } catch {
          // ignore
        }
      }, timeoutMs);

      child.stdout?.on('data', (data) => {
        stdout += data.toString('utf8');
        // Cap buffer to avoid out of memory
        if (stdout.length > 500000) {
          stdout = stdout.slice(-250000) + '\n... [output truncated]';
        }
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString('utf8');
        if (stderr.length > 500000) {
          stderr = stderr.slice(-250000) + '\n... [error truncated]';
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        this.activeProcesses.delete(procId);
        resolve({
          command,
          cwd,
          risk,
          stdout,
          stderr: stderr ? `${stderr}\n${err.message}` : err.message,
          exitCode: 1,
          durationMs: Date.now() - startTime,
        });
      });

      child.on('close', (code, signal) => {
        clearTimeout(timer);
        this.activeProcesses.delete(procId);
        if (killed) {
          stderr += `\n[Process terminated after ${timeoutMs / 1000}s timeout]`;
        }
        const exitCode = killed ? 124 : (code ?? (signal ? 130 : 1));
        this.recordHistory({
          id: procId,
          command,
          cwd,
          exitCode,
          durationMs: Date.now() - startTime,
          source,
          timestamp: Date.now(),
        });
        resolve({
          command,
          cwd,
          risk,
          stdout,
          stderr,
          exitCode,
          durationMs: Date.now() - startTime,
        });
      });
    });
  }

  /**
   * Gracefully stops every process spawned by a user terminal command (used by
   * the terminal STOP button). Unlike killAll (shutdown), the processes get a
   * SIGTERM and are marked as stopped-by-user in their result.
   */
  public stopActive(): number {
    let stopped = 0;
    for (const [id, child] of this.activeProcesses) {
      try {
        terminateProcess(child);
        stopped++;
      } catch {
        // already gone
      }
    }
    return stopped;
  }

  /**
   * Terminate all running processes
   */
  public killAll(): void {
    for (const [id, child] of this.activeProcesses) {
      try {
        terminateProcess(child);
      } catch {
        // ignore
      }
    }
    this.activeProcesses.clear();
  }
}
