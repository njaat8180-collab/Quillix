/** Conservative retry classification: a failed write/terminal action is never replayed blindly. */
const RETRYABLE_READS = new Set([
  'read_file', 'list_directory', 'search_files', 'search_code', 'get_file_metadata', 'git_status',
]);
const TRANSIENT_ERRORS = /\b(?:EAGAIN|EBUSY|ETIMEDOUT|ECONNRESET|ECONNREFUSED|temporarily unavailable)\b/i;

export function mayRetryToolFailure(
  toolName: string,
  errorText: string,
  attemptsAlreadyRetried: number,
  hasBeenDenied = false,
): boolean {
  return !hasBeenDenied && attemptsAlreadyRetried < 1 && RETRYABLE_READS.has(toolName) && TRANSIENT_ERRORS.test(errorText);
}

export function isPermissionBlock(text: string, needsApproval = false): boolean {
  return needsApproval || /(?:permission denied|approval denied|user denied|user denied authorization|denied authorization|approval (?:required|pending)|pending user approval|permission refused)/i.test(text);
}
