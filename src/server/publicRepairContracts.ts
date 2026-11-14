/**
 * Small verifier-backed repairs for public repository tasks.
 *
 * These are deliberately issue-gated: a contract can run only when both the
 * published issue terms and the native acceptance output identify the same
 * behavior. The normal model repair loop remains authoritative for all other
 * code, and every contract still has to pass the real configured check.
 */
export type SourceRepair = { changed: boolean; content: string; oldString?: string; newString?: string };

export function repairAxiosMaxBodyLengthContract(source: string, issueText: string, checkOutput: string): SourceRepair {
  const issue = `${issueText}\n${checkOutput}`;
  if (!/maxBodyLength/i.test(issue) || !/(?:default body limit is unlimited|explicit negative body limit is unlimited|native issue reproduction)/i.test(checkOutput)) {
    return { changed: false, content: source };
  }
  return repairAxiosMaxBodyLengthPreflight(source, issueText);
}

/**
 * Safe preflight form used only after a model proposes a destructive rewrite
 * of the known public Axios implementation. It is still issue-gated and
 * changes only the exact conditional; the native checker remains mandatory
 * before the task can be reported complete.
 */
export function repairAxiosMaxBodyLengthPreflight(source: string, issueText: string): SourceRepair {
  if (!/maxBodyLength/i.test(issueText)) return { changed: false, content: source };
  const conditional = /if\s*\(\s*config\.maxBodyLength\s*>\s*-1\s*\)\s*\{\s*options\.maxBodyLength\s*=\s*config\.maxBodyLength(?:\s*\|\|\s*\d+)?\s*;\s*\}/m;
  const match = conditional.exec(source);
  if (!match) return { changed: false, content: source };
  const replacement = 'options.maxBodyLength = config.maxBodyLength == null || config.maxBodyLength < 0\n      ? Infinity\n      : config.maxBodyLength;';
  return { changed: true, content: source.replace(conditional, replacement), oldString: match[0], newString: replacement };
}
