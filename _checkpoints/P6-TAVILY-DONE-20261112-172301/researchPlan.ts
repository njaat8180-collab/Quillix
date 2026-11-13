/**
 * Deep Research planning (M-TAVILY-3).
 *
 * Pure rules for turning a user question into a bounded set of search queries
 * and for assembling a cited evidence block the model may synthesize from.
 * Everything is bounded: at most RESEARCH_LIMITS.maxQueries queries, each
 * sanitized and de-duplicated, and the evidence block is capped so a large
 * research run can never blow up one model request.
 */

export const RESEARCH_LIMITS = {
  maxQueries: 5,
  maxQueryChars: 300,
  maxEvidenceChars: 12_000,
  maxSourcesShown: 8,
} as const;

/** Clamp model-planned queries: bounded, sanitized, de-duplicated, ordered. */
export function clampResearchQueries(raw: unknown, max: number = RESEARCH_LIMITS.maxQueries): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const queries: string[] = [];
  const limit = Math.max(1, Math.floor(max));
  for (const entry of raw) {
    if (queries.length >= limit) break;
    if (typeof entry !== 'string') continue;
    // Reuse the web-search sanitizer by requiring the caller to pass clean
    // strings; here we only bound + trim, so this module stays dependency-free.
    const query = entry.replace(/\s+/g, ' ').trim().slice(0, RESEARCH_LIMITS.maxQueryChars);
    if (query.length < 2) continue;
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push(query);
  }
  return queries;
}

export interface ResearchEvidence {
  query: string;
  citations: string;
}

/** Build the bounded, cited evidence block for the synthesis prompt. */
export function buildResearchEvidenceBlock(results: ResearchEvidence[], maxChars: number = RESEARCH_LIMITS.maxEvidenceChars): string {
  const blocks: string[] = [];
  let total = 0;
  const limit = Math.max(1, Math.floor(maxChars));
  for (const result of results) {
    const block = `Query: ${result.query}\n${result.citations}`;
    if (!result.citations.trim()) continue;
    if (total + block.length > limit) break;
    blocks.push(block);
    total += block.length;
  }
  return blocks.join('\n\n');
}

/** The instruction appended to the synthesis prompt: cite or stay silent. */
export function researchSynthesisInstruction(): string {
  return [
    'Using ONLY the retrieved evidence below, answer the user question.',
    'Cite the sources you used with their [n] markers inline.',
    'If the evidence does not answer the question, say so explicitly — never invent facts or citations.',
    'Keep the answer focused and technical; end with a "Sources:" list of the [n] markers you used.',
  ].join(' ');
}
