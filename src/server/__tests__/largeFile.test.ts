import { describe, expect, it } from 'vitest';
import { LARGE_FILE_BYTES, MAX_FILE_BYTES, fileSizeLimitError, formatFileSize, largeFileAdvisory } from '../../shared/largeFile.js';

describe('large-file limits (M9.5)', () => {
  it('formats sizes honestly', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatFileSize(-5)).toBe('0 B');
  });

  it('keeps the advisory threshold below the hard ceiling', () => {
    expect(LARGE_FILE_BYTES).toBeGreaterThan(0);
    expect(MAX_FILE_BYTES).toBeGreaterThan(LARGE_FILE_BYTES);
    expect(fileSizeLimitError(MAX_FILE_BYTES + 1)).toMatch(/File too large to handle safely/);
    expect(fileSizeLimitError(MAX_FILE_BYTES + 1)).toContain('8.0 MB');
    expect(largeFileAdvisory(2 * 1024 * 1024)).toBe('Large file (2.0 MB) — editing may be slower and AI features skip it.');
    // A file under the advisory threshold produces no warning context.
    expect(LARGE_FILE_BYTES).toBeLessThanOrEqual(1_000_000);
  });
});
