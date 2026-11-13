/** Explicit editing clauses only: mentioning a file is not permission to rewrite it. */
export function requestedEditTargets(prompt: string): string[] {
  const matches = [...prompt.matchAll(/(?:[\w.-]+[\\/])*[\w.-]+\.(?:[cm]?[jt]sx?|py|go|rs|java|cs|cpp|c|html?|css|vue|svelte|rb|php)\b/gi)];
  const targets: string[] = [];
  let priorWasEdit = false, previousEnd = 0;
  for (const match of matches) {
    const before = prompt.slice(previousEnd, match.index);
    // Decimal versions such as "Axios 0.24" are not sentence boundaries.
    // Keep the preceding edit verb attached to an explicit later file path.
    const clause = before.slice(-160).replace(/(?<=\d)\.(?=\d)/g, '');
    const denied = /\b(?:do\s+not|don't|never|without|avoid)\b[^.!;\n]*\b(?:edit|modify|change|rewrite|touch|update)\b/i.test(clause) ||
      /(?:मत\s*(?:बदल|छू|एडिट|अपडेट|लिख)|नहीं\s*(?:बदल|छू|एडिट|अपडेट|लिख)|बिल्कुल\s*मत\s*बदल)/i.test(clause);
    const explicit = /\b(?:fix|repair|refactor|modify|edit|update|rewrite|change|implement|optimi[sz]e|create|write|add|generate|scaffold|wire|link)\b[^.!;\n]*$/i.test(clause) ||
      /(?:बनाओ|बनाना|बनवाओ|बनवा|जोड़ो|जोड़|लिंक\s*करो|बदल|अपडेट|ठीक\s*करो|लिखो)[^.!;\n]*$/i.test(clause);
    const nextFile = matches.find(candidate => candidate.index! > match.index!)?.index ?? prompt.length;
    const after = prompt.slice(match.index! + match[0].length, nextFile);
    const deniedAfter = /^(?:\s|को|को\s+)?[^.!;\n]{0,100}(?:मत\s*(?:बदल|छू|एडिट|अपडेट|लिख)|नहीं\s*(?:बदल|छू|एडिट|अपडेट|लिख)|बिल्कुल\s*मत\s*बदल)/i.test(after);
    const explicitAfter = /^(?:\s|में|को|पर|के\s+लिए|का|की|के)?[^.!;\n]{0,100}(?:बनाओ|बनाना|बनवाओ|बनवा|जोड़ो|जोड़|लिंक\s*करो|लिखो)/i.test(after);
    const conjunction = /^\s*(?:,\s*)?(?:(?:and|और)\s+)?(?:the\s+)?$/i.test(before);
    const editing: boolean = !denied && !deniedAfter && (explicit || explicitAfter || (priorWasEdit && conjunction));
    const file = match[0].replace(/\\/g, '/').replace(/^\.\//, '');
    if (editing && !/(?:^|\/)(?:[^/]*\.)?(?:test|spec)\.[^/]+$/i.test(file) && !targets.includes(file)) targets.push(file);
    // Test files are editable only when the user directly requests that exact file.
    if (editing && explicit && /(?:^|\/)(?:[^/]*\.)?(?:test|spec)\.[^/]+$/i.test(file) && !targets.includes(file)) targets.push(file);
    priorWasEdit = editing;
    previousEnd = match.index! + match[0].length;
  }
  return targets.slice(0, 12);
}

/** Resolve requests addressed to a file by role, e.g. "make the stylesheet responsive".
 * A link or a filename used as a reference is not itself an instruction to edit it.
 * Only use an unambiguous existing candidate for each explicitly addressed role. */
export function websiteRoleTargets(prompt: string, candidates: string[]): string[] {
  const roleExtension = { html: /\.html?$/i, stylesheet: /\.css$/i, script: /\.[cm]?js$/i };
  const targets = new Set<string>();
  for (const clause of prompt.split(/(?:[.!?;]\s+|\n+|,?\s+and\s+(?=(?:make|fix|repair|update|improve|edit|change)\b))/i)) {
    const role = clause.trim().match(/^(?:please\s+)?(?:make|fix|repair|update|improve|edit|change)\s+(?:the\s+)?(?:browser\s+)?(html|stylesheet|css|javascript|js|script)\b(?!\.\w)/i)?.[1].toLowerCase();
    if (!role) continue;
    const extension = roleExtension[role === 'html' ? 'html' : /^(css|stylesheet)$/.test(role) ? 'stylesheet' : 'script'];
    const matches = candidates.filter(file => extension.test(file));
    if (matches.length === 1) targets.add(matches[0]);
  }
  return [...targets];
}

/** A role-addressed instruction is the relevant slice for a one-file turn. */
export function websiteRoleInstruction(prompt: string, file: string): string {
  const role = /\.html?$/i.test(file) ? 'html' : /\.css$/i.test(file) ? '(?:stylesheet|css)' : '(?:javascript|js|script)';
  const addressed = new RegExp(`^(?:please\\s+)?(?:make|fix|repair|update|improve|edit|change)\\s+(?:the\\s+)?(?:browser\\s+)?${role}\\b(?!\\.\\w)`, 'i');
  return prompt.split(/(?:[.!?;]\s+|\n+)/).filter(clause => addressed.test(clause.trim())).join('. ');
}

/** Keep a file's own editing clause prominent; do not apply file A's fix blindly to file B. */
export function targetInstruction(prompt: string, file: string): string {
  const normalized = prompt.replace(/\\/g, '/');
  const index = normalized.indexOf(file);
  if (index < 0) return '';
  const leftStart = Math.max(0, index - 160), left = normalized.slice(leftStart, index);
  const actions = [...left.matchAll(/\b(?:fix|repair|refactor|modify|edit|update|rewrite|change|implement|optimi[sz]e|create|write|add|generate|scaffold|wire|link)\b/gi)];
  const start = actions.length ? leftStart + actions.at(-1)!.index! : index;
  const afterFile = index + file.length;
  const tail = normalized.slice(afterFile);
  const boundary = tail.search(/[.;]\s|\n|\b(?:and\s+)?(?:fix|repair|refactor|modify|edit|update|rewrite)\b/i);
  return normalized.slice(start, boundary < 0 ? undefined : afterFile + boundary).trim().slice(0, 600);
}
