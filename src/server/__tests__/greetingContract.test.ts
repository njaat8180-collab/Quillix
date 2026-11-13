import { describe, expect, it } from 'vitest';
import { repairGreetingContract } from '../greetingContract.js';

describe('explicit greeting contract repair', () => {
  it('adds a safe default for missing names and preserves CommonJS export', () => {
    const source = `function greet(name) {
  const trimmedName = name.trim();
  return trimmedName === '' ? 'Hello, World!' : \`Hello, \${trimmedName}!\`;
}
exports.greet = greet;`;
    const repaired = repairGreetingContract(source);
    expect(repaired.changed).toBe(true);
    expect(repaired.content).toContain("function greet(name = '')");
    expect(repaired.content).toContain('String(name).trim()');
    expect(repaired.content).toContain('exports.greet = greet');
    expect(repairGreetingContract(repaired.content).changed).toBe(false);
  });

  it('does not rewrite unrelated source', () => {
    const source = 'exports.add = (a, b) => a + b;';
    expect(repairGreetingContract(source)).toEqual({ content: source, changed: false });
  });
});
