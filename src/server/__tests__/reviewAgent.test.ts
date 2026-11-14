import { describe, expect, it } from 'vitest';
import { parseReviewFindings } from '../reviewAgent.js';

describe('independent reviewer output contract', () => {
  it('accepts bounded actionable findings from JSON or a JSON fence', () => {
    expect(parseReviewFindings('```json\n{"findings":[{"severity":"major","file":"src/app.ts","line":12,"issue":"Missing null check"}]}\n```'))
      .toEqual([{ severity: 'major', file: 'src/app.ts', line: 12, issue: 'Missing null check' }]);
  });

  it('rejects absolute and traversal paths and ignores malformed output', () => {
    expect(parseReviewFindings(JSON.stringify({ findings: [
      { severity: 'blocker', file: '../outside.ts', issue: 'unsafe path' },
      { severity: 'major', file: 'C:/secret.ts', issue: 'absolute path' },
      { severity: 'minor', file: 'src/ui.ts', issue: 'real issue' },
    ] }))).toEqual([{ severity: 'minor', file: 'src/ui.ts', issue: 'real issue' }]);
    expect(parseReviewFindings('not JSON')).toEqual([]);
  });
});
