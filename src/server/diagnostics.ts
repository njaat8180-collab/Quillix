import { SystemHealthItem } from '../shared/types.js';
import { TerminalService } from './terminal.js';
import { OllamaQwenProvider } from './qwen.js';

export class DiagnosticsService {
  private terminal: TerminalService;
  private ollama: OllamaQwenProvider;

  constructor(terminal: TerminalService, ollama: OllamaQwenProvider) {
    this.terminal = terminal;
    this.ollama = ollama;
  }

  public async runHealthCheck(cwd: string): Promise<SystemHealthItem[]> {
    const items: SystemHealthItem[] = [];

    // 1. Local Ollama / Qwen backend
    const ollama = await this.ollama.getStatus();
    items.push({
      id: 'ollama',
      name: 'Ollama (Local Qwen)',
      category: 'service',
      status: ollama.connected && ollama.modelAvailable ? 'available' : ollama.connected ? 'warning' : 'missing',
      version: ollama.model,
      details: ollama.details,
    });

    // 2. Node.js
    const nodeRes = await this.terminal.executeCommand('node -v', cwd);
    items.push({
      id: 'node',
      name: 'Node.js Runtime',
      category: 'runtime',
      status: nodeRes.exitCode === 0 ? 'available' : 'missing',
      version: nodeRes.exitCode === 0 ? nodeRes.stdout.trim() : undefined,
      details: nodeRes.exitCode === 0 ? 'Active Node.js engine for execution & tooling' : 'Node.js binary not found in PATH',
    });

    // 3. npm
    const npmRes = await this.terminal.executeCommand('npm -v', cwd);
    items.push({
      id: 'npm',
      name: 'npm Package Manager',
      category: 'tool',
      status: npmRes.exitCode === 0 ? 'available' : 'missing',
      version: npmRes.exitCode === 0 ? `v${npmRes.stdout.trim()}` : undefined,
      details: npmRes.exitCode === 0 ? 'Node package manager ready for dependency installation' : 'npm not in PATH',
    });

    // 4. Git
    const gitRes = await this.terminal.executeCommand('git --version', cwd);
    items.push({
      id: 'git',
      name: 'Git Version Control',
      category: 'tool',
      status: gitRes.exitCode === 0 ? 'available' : 'missing',
      version: gitRes.exitCode === 0 ? gitRes.stdout.trim() : undefined,
      details: gitRes.exitCode === 0 ? 'Git CLI available for status, diffs, branches, and commits' : 'Git not installed',
    });

    // 5. PowerShell / pwsh
    const psRes = await this.terminal.executeCommand('powershell -Command "$PSVersionTable.PSVersion.ToString()"', cwd);
    const pwshRes = psRes.exitCode === 0 ? psRes : await this.terminal.executeCommand('pwsh --version', cwd);
    items.push({
      id: 'powershell',
      name: 'PowerShell',
      category: 'tool',
      status: pwshRes.exitCode === 0 ? 'available' : 'warning',
      version: pwshRes.exitCode === 0 ? pwshRes.stdout.trim() : undefined,
      details: pwshRes.exitCode === 0 ? 'PowerShell command processor available' : 'PowerShell not detected; standard bash/sh available',
    });

    // 6. Python
    const pyRes = await this.terminal.executeCommand('python3 --version', cwd);
    items.push({
      id: 'python',
      name: 'Python 3',
      category: 'runtime',
      status: pyRes.exitCode === 0 ? 'available' : 'missing',
      version: pyRes.exitCode === 0 ? pyRes.stdout.trim() : undefined,
      details: pyRes.exitCode === 0 ? 'Python interpreter ready' : 'Python not in system PATH',
    });

    // 7. Rust / Cargo
    const cargoRes = await this.terminal.executeCommand('cargo --version', cwd);
    items.push({
      id: 'cargo',
      name: 'Rust / Cargo',
      category: 'tool',
      status: cargoRes.exitCode === 0 ? 'available' : 'missing',
      version: cargoRes.exitCode === 0 ? cargoRes.stdout.trim() : undefined,
      details: cargoRes.exitCode === 0 ? 'Rust toolchain installed' : 'Cargo not in PATH',
    });

    // 8. Go
    const goRes = await this.terminal.executeCommand('go version', cwd);
    items.push({
      id: 'go',
      name: 'Go Toolchain',
      category: 'runtime',
      status: goRes.exitCode === 0 ? 'available' : 'missing',
      version: goRes.exitCode === 0 ? goRes.stdout.trim() : undefined,
      details: goRes.exitCode === 0 ? 'Go compiler ready' : 'Go not in PATH',
    });

    return items;
  }
}
