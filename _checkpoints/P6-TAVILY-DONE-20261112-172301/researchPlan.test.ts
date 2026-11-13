import { describe, expect, it } from 'vitest';
import { RESEARCH_LIMITS, buildResearchEvidenceBlock, clampResearchQueries, researchSynthesisInstruction } from '../../shared/researchPlan.js';

describe('research plan (M-TAVILY-3)', () => {
  it('clamps, trims, de-duplicates and orders planned queries', () => {
    expect(clampResearchQueries(['react use hook', 'react use hook', 'React 19 release notes', 42, 'a', 'react 19 migration']))
      .toEqual(['react use hook', 'React 19 release notes', 'react 19 migration']);
    expect(clampResearchQueries(['x'.repeat(500)])[0].length).toBe(RESEARCH_LIMITS.maxQueryChars);
    expect(clampResearchQueries('not-an-array')).toEqual([]);
    expect(clampResearchQueries(['react', 'hooks', 'state', 'effects', 'context', 'memo'], 3)).toEqual(['react', 'hooks', 'state']);
    expect(clampResearchQueries([])).toEqual([]);
  });

  it('builds a bounded cited evidence block and skips empty results', () => {
    const block = buildResearchEvidenceBlock([
      { query: 'q1', citations: '[1] Docs — react.dev' },
      { query: 'q2', citations: '' },
      { query: 'q3', citations: '[2] Blog — react.dev' },
    ]);
    expect(block).toContain('Query: q1');
    expect(block).not.toContain('q2');
    expect(block).toContain('[2] Blog');
    expect(buildResearchEvidenceBlock([{ query: 'q', citations: '[1] x' }], 10)).toBe('');
    expect(buildResearchEvidenceBlock([])).toBe('');
  });

  it('requires citations in synthesis or an honest refusal', () => {
    const instruction = researchSynthesisInstruction();
    expect(instruction).toMatch(/Cite the sources/);
    expect(instruction).toMatch(/never invent facts/);
  });
});
