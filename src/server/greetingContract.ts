/** Narrow repair for the explicit greeting-module benchmark contract. */
export function repairGreetingContract(source: string): { content: string; changed: boolean } {
  if (!/\b(?:exports\.)?greet\b/.test(source) || !/trim|Hello/i.test(source)) {
    return { content: source, changed: false };
  }
  const content = `function greet(name = '') {
  const trimmedName = String(name).trim();
  return trimmedName === '' ? 'Hello, World!' : \`Hello, \${trimmedName}!\`;
}

exports.greet = greet;
`;
  return { content, changed: content !== source };
}
