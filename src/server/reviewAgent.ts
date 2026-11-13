export type ReviewFinding = {
  severity: 'blocker' | 'major' | 'minor';
  file: string;
  line?: number;
  issue: string;
};

/** Parse only concrete, workspace-relative findings from the read-only reviewer. */
export function parseReviewFindings(response: string): ReviewFinding[] {
  const text = String(response || '').trim();
  const candidates = [text, text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || ''];
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
        if (!['blocker', 'major', 'minor'].includes(String(severity)) || !issue || !file ||
            file.startsWith('/') || /^[A-Za-z]:/.test(file) || file.split('/').includes('..')) return [];
        const line = Number.isInteger(finding.line) && Number(finding.line) > 0 ? Number(finding.line) : undefined;
        return [{ severity: severity as ReviewFinding['severity'], file, ...(line ? { line } : {}), issue }];
      }).slice(0, 8);
    } catch { /* try a fenced JSON object, otherwise fail closed to no actionable finding */ }
  }
  return [];
}

