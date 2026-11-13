/** The current task ends at HTML when the user gates the remaining assets. */
export function isHtmlApprovalStageRequest(prompt: string): boolean {
  return /\b(?:first|start)\b[^.!?\n]{0,90}\bhtml\b/i.test(prompt) &&
    /\b(?:when|after|once|until)\b[^.!?\n]{0,60}\b(?:approve|approval|confirm)\b[^.!?\n]{0,100}\b(?:css|javascript|js|other\s+(?:files?|lang\w*)|remaining|rest)\b/i.test(prompt);
}

export const HTML_STAGE_APPROVAL_MESSAGE = 'HTML stage complete. Awaiting your approval before CSS and JavaScript.';

/** Only a direct reply to the stage-completion message authorizes the next stage. */
export function approvedHtmlStageContinuation(prompt: string, history: {role: string; content: string}[]): string | undefined {
  if (!/^(?:yes|yes please|ok|okay|approved?|i approve|go ahead|continue|हाँ|हां|आगे बढ़ो)[.!\s]*$/i.test(prompt.trim())) return undefined;
  const lastMessage = history.at(-1);
  if (lastMessage?.role !== 'assistant' || typeof lastMessage.content !== 'string' ||
      !lastMessage.content.includes(HTML_STAGE_APPROVAL_MESSAGE)) return undefined;
  const original = history.slice(0, -1).reverse().find(message =>
    message?.role === 'user' && typeof message.content === 'string' && isHtmlApprovalStageRequest(message.content));
  if (!original) return undefined;
  const brief = original.content.split(/\b(?:first|start)\b/i)[0].trim();
  return `Continue the approved HTML stage in this workspace. Read the existing index.html. Create style.css and script.js, connect them to index.html, and implement the remaining frontend work. Preserve the existing HTML. Original brief: ${brief}`;
}

/** User explicitly wants a file in the active workspace, not a new project folder. */
export function isSingleFileCreationRequest(prompt: string): boolean {
  if (isHtmlApprovalStageRequest(prompt)) return true;
  // Runtime names such as "Node.js" contain a file-looking suffix, but a
  // request for a Node/Python/etc. application is a multi-file project.
  if (/\b(?:node\s*\.?\s*js|python|javascript|typescript|react)\s+(?:application|app|project|program)\b/i.test(prompt)) return false;
  const namedFiles = Array.from(prompt.matchAll(/\b[\w./-]+\.(?:cjs|mjs|js|jsx|ts|tsx|py|html|htm|css|json|md|vue|svelte|go|rs|java|cpp|c|cs|php|rb)\b/gi));
  // A prompt mentioning multiple concrete files is a project request even if
  // it starts with wording such as “create index.html”.
  if (new Set(namedFiles.map((match) => match[0].toLowerCase())).size > 1) return false;
  // Explicitly inline website requests are one deliverable even when the
  // user does not name index.html. This prevents the normal three-file web
  // contract from forcing a large single-file response through a tiny budget.
  if (/\b(?:all\s+(?:the\s+)?(?:css|styles?)\s+and\s+(?:js|javascript)|(?:css|styles?)\s*(?:and|\+|&)\s*(?:js|javascript))\b[\s\S]{0,60}\b(?:in|inside|within)\s+(?:one|a\s+single)\s+(?:html?|file)\b/i.test(prompt) ||
      /\b(?:single|one)[- ]file\s+(?:html?|website|webpage)\b/i.test(prompt)) return true;
  return /\b(file|files|filename)\s+(named|called)\s+[\w][\w.-]*/i.test(prompt) ||
    /\b(write|create|make)\s+(the\s+)?file\s+[\w.-]+\.[a-z0-9]{1,6}\b/i.test(prompt) ||
    /\b(?:create|make|build|write)\s+(?:a|an|the)?\s*[\w.-]+\.(?:html?|css|[cm]?js|tsx?|jsx|py|json|md)\b(?:\s+(?:page|file))?/i.test(prompt);
}

/** Plain websites have a canonical root layout so preview and asset checks can
 * resolve the three core files without guessing through arbitrary folders. */
export function isPlainWebsiteRequest(prompt: string, isSingleFileRequest = false): boolean {
  if (isSingleFileRequest) return false;
  const text = prompt || '';
  const website = /\b(website|web\s?site|webpage|web\s?page|landing page|browser game|html game|e[- ]?commerce|storefront|online shop|online store|shop site)\b|\b(?:plain\s+)?html\s*[/+&]\s*css\s*[/+&]\s*(?:java)?script\b|(?:वेबसाइट|वेब\s?साइट|वेब\s?पेज|ई[- ]?कॉमर्स|ऑनलाइन\s+शॉप)/i.test(text);
  // File extensions are targets, not evidence that a user asked to create or
  // audit a whole website. In particular, a follow-up mentioning
  // index.html/style.css/app.js must stay a scoped multi-file edit instead of
  // activating the broad website quality gate and its extra tools.
  const prose = text.replace(/\b[\w./-]+\.(?:html?|css|[cm]?js)\b/gi, ' ');
  const browserStack = /\bhtml\b/i.test(prose) && /\bcss\b/i.test(prose) && /\b(?:javascript|js)\b/i.test(prose);
  const implicitlyWebApp = /\b(calculator|to-?do|todo|portfolio|dashboard|landing page|task tracker)\b/i.test(text) &&
    !/\b(python|java|rust|c\+\+|c#|command\.line|cli|terminal|console|native|desktop|mobile|android|ios)\b/i.test(text);
  const framework = /\b(react|next\.?js|vue|angular|svelte|astro|typescript|vite|wordpress|django|flask|fastapi)\b/i.test(text);
  const nonBrowserService = /\b(python|java|rust|c\+\+|c#|command\.line|cli|terminal|console|native|desktop|mobile|android|ios)\b.*\b(api|service|server|backend)\b/i.test(text);
  const oneFile = /\b(single[- ]file|one[- ]file|only\s+(?:one|a single)\s+file|inline\s+(?:css|javascript)|(?:all\s+(?:the\s+)?(?:css|styles?)\s+and\s+(?:js|javascript)|(?:css|styles?)\s*(?:and|\+|&)\s*(?:js|javascript))[\s\S]{0,60}\b(?:in|inside|within)\s+(?:one|a\s+single)\s+(?:html?|file))\b/i.test(text);
  return !framework && !oneFile && !nonBrowserService && (website || browserStack || implicitlyWebApp);
}

/**
 * Conservative completion contract for a newly generated project.
 * Never assumes a fixed framework: explicit file names win, while a clear
 * request for a plain website receives the three essential source files.
 * The contract is checked against successful disk writes, not model prose.
 */
export function requiredProjectFiles(prompt: string, isSingleFileRequest = false): string[] {
  if (isHtmlApprovalStageRequest(prompt)) return ['index.html'];
  const namedFiles = Array.from(prompt.matchAll(/\b[\w./-]+\.(?:cjs|mjs|js|jsx|ts|tsx|py|html|htm|css|json|md|vue|svelte|go|rs|java|cpp|c|cs|php|rb|svg|png|jpe?g|webp|ico|yaml|yml)\b/gi))
    .map(match => match[0].replace(/\\/g, '/'))
    .filter(name => name.toLowerCase() !== 'node.js');
  const explicit = [...new Set(namedFiles)];
  if (isSingleFileRequest) return explicit.length ? explicit : ['index.html'];

  // For a clearly requested *plain* website the model must not silently stop
  // after writing index.html; CSS and JavaScript are separate deliverables.
  const plainWebsite = isPlainWebsiteRequest(prompt);
  const implicitlyWebApp = /\b(calculator|to-?do|todo|portfolio|dashboard|landing page|task tracker)\b/i.test(prompt)
    && !/\b(python|java|rust|c\+\+|c#|command.line|cli|terminal|console|native|desktop|mobile|android|ios)\b/i.test(prompt);
  const frameworkWebsite = /\b(react|next\.?js|vue|angular|svelte|astro|typescript|vite|wordpress|django|flask|fastapi)\b/i.test(prompt);
  const oneFile = /\b(single[- ]file|one[- ]file|only\s+(?:one|a single)\s+file|inline\s+(?:css|javascript)|(?:all\s+(?:the\s+)?(?:css|styles?)\s+and\s+(?:js|javascript)|(?:css|styles?)\s*(?:and|\+|&)\s*(?:js|javascript))[\s\S]{0,60}\b(?:in|inside|within)\s+(?:one|a\s+single)\s+(?:html?|file))\b/i.test(prompt);
  // Naming a logo or config does not waive the website's core source files.
  if (oneFile) return explicit.length ? explicit : ['index.html'];
  if (explicit.length && (frameworkWebsite || oneFile || !(plainWebsite || implicitlyWebApp) ||
      explicit.some(file => /\.(?:html?|css|[cm]?js|jsx|tsx?)$/i.test(file)))) return explicit;
  if ((plainWebsite || implicitlyWebApp) && !frameworkWebsite && !oneFile) {
    const required = ['index.html', 'style.css', 'script.js', ...explicit];
    // Keep optional deliverables deterministic when the user asks for them
    // without naming a path. The model receives this manifest and writes the
    // actual files; verifier checks ensure references are present and linked.
    if (/\b(asset|assets|image|images|logo|favicon|icon)\b/i.test(prompt) &&
        !explicit.some(file => /\.(?:png|jpe?g|gif|webp|svg|ico)$/i.test(file))) {
      required.push('assets/placeholder.svg');
    }
    if (/\b(config|configuration|settings\s+file)\b/i.test(prompt) &&
        !explicit.some(file => /(?:config|settings).*(?:json|js|ts)$/i.test(file))) {
      required.push('config.json');
    }
    return required;
  }
  return explicit;
}
