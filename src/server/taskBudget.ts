/** Task-size budgets are upper bounds, not a reason to skip verification. */
export function taskBudget(prompt: string, singleFile: boolean, currentFile?: string) {
  const namedFiles = [...new Set(prompt.match(/(?:[\w.-]+[\\/])*[\w.-]+\.(?:html?|css|[cm]?[jt]sx?|py|jsonc?|ya?ml|md|go|rs|java|cs|cpp|sql)\b/gi) || [])];
  const explicitChecks = /\b(test|tests|build|lint|typecheck|compile|run|execute|verify|verification)\b|टेस्ट|चलाओ|बिल्ड/.test(prompt.toLowerCase());
  const complex = prompt.length > 1200 || namedFiles.length > 2 || /\b(full.stack|multi.file|entire|architecture|authentication|database|migration|production.ready)\b/i.test(prompt);
  const richSingleFile = singleFile && prompt.length > 160;
  const publicBenchmark = process.env.QUILLIX_PUBLIC_BENCHMARK === '1';
  // A short request naming two concrete files is still a bounded repair, not
  // a repository-wide task. Keep the tool surface focused even when the user
  // also asks to run tests/build verification.
  const focused = publicBenchmark || (!complex && prompt.length < 650 && (singleFile || (namedFiles.length >= 1 && namedFiles.length <= 2) || !!currentFile));
  return {
    focused, explicitChecks, maxTurns: focused ? (publicBenchmark ? 8 : 4) : complex ? 16 : 10,
    repairAttempts: focused ? (publicBenchmark ? 4 : 2) : complex ? 6 : 4,
    // 3B coding models need enough room for the system contract, a focused
    // file excerpt and tool schemas. These are still bounded for fast local
    // inference; they avoid silently truncating the instructions that make
    // the model edit instead of narrate.
    contextChars: publicBenchmark ? 8500 : focused ? (richSingleFile ? 7000 : 5000) : 14000, historyChars: focused ? 1800 : 8000,
    contextWindow: publicBenchmark ? 8192 : focused ? (richSingleFile ? 8192 : 6144) : 12288, maxOutputTokens: publicBenchmark ? 3072 : focused ? (richSingleFile ? 6144 : 2560) : 4096,
    finishAfterWrite: focused && singleFile && !explicitChecks,
  };
}
