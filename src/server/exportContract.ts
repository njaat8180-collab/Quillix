import { parse } from '@babel/parser';

/** Only enforce an explicitly requested named CommonJS API, never infer an API from prose. */
export function requestedCommonJSExports(prompt: string): string[] {
  return [...new Set([...prompt.matchAll(/\b(?:export|expose|provide)\b[^.\n]{0,100}?\b(?:via|as|using)\s+(?:module\.)?exports\.([A-Za-z_$][\w$]*)/gi)].map(match => match[1]))];
}

/** Static declaration evidence only; it does not execute generated code or prove behavior. */
export function declaredCommonJSExports(source: string): Set<string> {
  const names = new Set<string>();
  if (source.length > 512 * 1024) return names;
  const key = (node: any): string | undefined => node?.type === 'Identifier' ? node.name
    : node?.type === 'StringLiteral' ? node.value : undefined;
  const member = (node: any): string | undefined => {
    if (node?.type === 'Identifier') return node.name;
    if (node?.type !== 'MemberExpression' || (node.computed && node.property?.type !== 'StringLiteral')) return undefined;
    const parent = member(node.object), property = key(node.property);
    return parent && property ? `${parent}.${property}` : undefined;
  };
  const properties = (node: any) => {
    if (node?.type !== 'ObjectExpression') return;
    for (const property of node.properties) {
      if (property.computed && property.key?.type !== 'StringLiteral') continue;
      const name = key(property.key);
      if (name) names.add(name);
    }
  };
  try {
    const ast = parse(source, { sourceType: 'unambiguous' });
    const queue: any[] = [ast.program];
    for (let i = 0; i < queue.length && i < 30000; i++) {
      const node = queue[i];
      if (node.type === 'AssignmentExpression' && node.operator === '=') {
        const target = member(node.left);
        const match = target?.match(/^(?:module\.)?exports\.([A-Za-z_$][\w$]*)$/);
        if (match) names.add(match[1]);
        if (target === 'module.exports') properties(node.right);
      }
      if (node.type === 'CallExpression' && member(node.callee) === 'Object.assign' && ['exports', 'module.exports'].includes(member(node.arguments[0]) || '')) {
        for (const argument of node.arguments.slice(1)) properties(argument);
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) for (const child of value) { if (child?.type) queue.push(child); }
        else if (value && typeof value === 'object' && 'type' in value) queue.push(value);
      }
    }
  } catch { /* the regular syntax verifier reports parse errors */ }
  return names;
}

/** Apply a narrow mechanical repair when an explicit CommonJS export is the
 * only verifier failure. It preserves the implementation and only converts a
 * top-level ESM declaration or adds the requested named export assignment. */
export function repairCommonJSExportContract(source: string, names: string[]): { content: string; changed: boolean } {
  let content = source.replace(/^\s*export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/gm, '');
  for (const name of names) {
    if (declaredCommonJSExports(content).has(name)) continue;
    const declaration = new RegExp(`(?:^|\\n)\\s*(?:async\\s+)?(?:function|class)\\s+${name}\\b|(?:^|\\n)\\s*(?:const|let|var)\\s+${name}\\s*=`, 'm');
    if (declaration.test(content)) content = `${content.trimEnd()}\n\nexports.${name} = ${name};\n`;
  }
  return { content, changed: content !== source };
}
