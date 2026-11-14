import { describe, expect, it } from 'vitest';
import { requestedCommonJSExports, declaredCommonJSExports, repairCommonJSExportContract } from '../exportContract.js';

describe('explicit CommonJS export contracts', () => {
  it('extracts explicit named API instructions without inferring APIs from prose', () => {
    expect(requestedCommonJSExports('Export a named function greet(name) via exports.greet.')).toEqual(['greet']);
    expect(requestedCommonJSExports('Provide a function as module.exports.parseData.')).toEqual(['parseData']);
    expect(requestedCommonJSExports('Create greet.cjs exporting greet(name).')).toEqual([]);
    expect(requestedCommonJSExports('Explain why exports.greet was removed.')).toEqual([]);
  });
  it('finds CommonJS named declarations in assignment and object forms', () => {
    expect([...declaredCommonJSExports('exports.greet = name => name;')]).toEqual(['greet']);
    expect([...declaredCommonJSExports('module.exports = { greet(name) { return name; } };')]).toEqual(['greet']);
    expect([...declaredCommonJSExports('Object.assign(exports, { greet: () => 1 });')]).toEqual(['greet']);
    expect([...declaredCommonJSExports('module.exports["greet"] = () => 1;')]).toEqual(['greet']);
  });
  it('does not treat comments, strings, dynamic keys or default function exports as named exports', () => {
    expect(declaredCommonJSExports('// exports.greet = () => 1;\nconst text = "exports.greet = 1";').size).toBe(0);
    expect(declaredCommonJSExports('module.exports = function greet() {};').size).toBe(0);
    expect(declaredCommonJSExports('exports[dynamic] = () => 1;').size).toBe(0);
  });
  it('mechanically repairs a missing named CommonJS export without changing the implementation', () => {
    const repaired = repairCommonJSExportContract('export function greet(name) { return name; }\n', ['greet']);
    expect(repaired.changed).toBe(true);
    expect(repaired.content).toContain('function greet(name)');
    expect(repaired.content).toContain('exports.greet = greet;');
    expect([...declaredCommonJSExports(repaired.content)]).toEqual(['greet']);
  });
});
