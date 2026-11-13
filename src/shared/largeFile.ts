/**
 * M9.5: large-file handling limits, shared so every surface agrees.
 *
 * Reading and writing both stop at MAX_FILE_BYTES (the editor can technically
 * hold more, but a half-written 40 MB paste is a support ticket, not a
 * feature). LARGE_FILE_BYTES is the advisory threshold: AI surfaces (retrieval,
 * inline completion) skip or shrink at this size, and the editor tells the user
 * when a file crosses it instead of silently janking.
 */

/** Advisory threshold for AI features and editor warnings. */
export const LARGE_FILE_BYTES = 1_000_000;
/** Hard ceiling for reading or writing a workspace file. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** Human-readable size, e.g. "2.3 MB". */
export function formatFileSize(bytes: number): string {
  const value = Math.max(0, Math.floor(bytes || 0));
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/** Honest refusal message for reads and writes over the hard ceiling. */
export function fileSizeLimitError(sizeBytes: number): string {
  return `File too large to handle safely (${formatFileSize(sizeBytes)}). Limit: ${formatFileSize(MAX_FILE_BYTES)}. Split the file or edit it outside NUVRO AI.`;
}

/** Non-blocking advisory shown when a file crosses the large threshold. */
export function largeFileAdvisory(sizeBytes: number): string {
  return `Large file (${formatFileSize(sizeBytes)}) — editing may be slower and AI features skip it.`;
}
