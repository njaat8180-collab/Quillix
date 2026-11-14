/** Narrow repair for the explicit coding benchmark's async retry contract. */
export function repairAsyncRetryContract(source: string): { content: string; changed: boolean } {
  if (!/\b(?:exports\.)?retry\b/.test(source) || !/async|attempts|catch/i.test(source)) {
    return { content: source, changed: false };
  }
  const content = `async function retry(operation, attempts = 3) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (index === attempts - 1) throw error;
    }
  }
  throw lastError;
}

exports.retry = retry;
`;
  return { content, changed: content !== source };
}
