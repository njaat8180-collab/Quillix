export type ReviewFinding = {
  severity: 'blocker' | 'major' | 'minor';
  file: string;
  line?: number;
  issue: string;
};

/**
 * True when the reviewer produced NO parseable findings object at all.
 * The parse result alone cannot distinguish "parsed, zero defects" from
 * "unparseable output" (truncated JSON, prose, unexpected shape) — callers
 * use this to report an unavailable review honestly instead of presenting it
 * as a clean review.
 */
export function reviewResponseIsUnparseable(response: string): boolean {
  const text = String(response || '').trim();
  if (!text) return true;
  const fencedBlocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(match => match[1]);
  for (const candidate of [text, ...fencedBlocks]) {
    try {
      const parsed = JSON.parse(candidate) as { findings?: unknown };
      if (Array.isArray(parsed.findings)) return false;
    } catch { /* try the next candidate */ }
  }
  return true;
}

/** Parse only concrete, workspace-relative findings from the read-only reviewer. */
export function parseReviewFindings(response: string): ReviewFinding[] {
  const text = String(response || '').trim();
  // Accept the JSON as the whole body OR inside ANY fenced block: reviewers
  // commonly emit an explanation fence before the findings fence, and dropping
  // the real findings made a review with blockers indistinguishable from a
  // clean review.
  const fencedBlocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(match => match[1]);
  const candidates = [text, ...fencedBlocks];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { findings?: unknown };
      if (!Array.isArray(parsed.findings)) continue;
      return parsed.findings.flatMap((value): ReviewFinding[] => {
        if (!value || typeof value !== 'object') return [];
        const finding = value as Record<string, unknown>;
        const severity = finding.severity;
        const file = typeof finding.file === 'string' ? finding.file.replace(/\\/g, '/') : '';
        const issue = typeof finding.issue === 'string' ? finding.issue.trim().slice(0, 500) : '';
        // Validate the severity as a STRING: String(['blocker']) would pass the
        // allow-list and let an array masquerade as a real blocker.
        if (typeof severity !== 'string' || !['blocker', 'major', 'minor'].includes(severity) || !issue || !file ||
             file.startsWith('/') || /^[A-Za-z]:/.test(file) || file.split('/').includes('..')) return [];
        const line = Number.isInteger(finding.line) && Number(finding.line) > 0 ? Number(finding.line) : undefined;
        return [{ severity: severity as ReviewFinding['severity'], file, ...(line ? { line } : {}), issue }];
      }).slice(0, 8);
    } catch { /* try the next candidate; fail closed to no actionable finding */ }
  }
  return [];
}
