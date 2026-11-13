/**
 * NUVRO AI Intent Router
 *
 * Deterministically classifies a user prompt as either:
 *  - 'chat'  → a normal conversational message (no tools, no file/terminal
 *              access, no project modification), or
 *  - 'agent' → a coding / project / file / terminal task that requires the
 *              autonomous agent loop with real tools.
 *
 * This runs BEFORE any model request. It is intentionally rule-based: a small
 * local model must never be trusted to decide whether "Hi" should execute
 * read_file on .env. When the classification is ambiguous the router prefers
 * 'chat' — a harmless conversational answer — over accidental tool use.
 */

import { hasConversationalQuestionLead, isMutationRequest } from '../shared/writeIntent.js';

export type IntentKind = 'chat' | 'agent';

/** Short conversational/greeting prompts that are unambiguously chat. */
const GREETING_PATTERNS: RegExp[] = [
  /^(hi+|hey+|hello+|yo|sup|hiya|howdy|hola|namaste)\b[.!]*$/i,
  /^(good\s?(morning|afternoon|evening|day|night))\b[.!]*$/i,
  /^(how\s+are\s+you(\s+doing)?)[?.!]*$/i,
  /^(thanks|thank\s+you|thx|ty|great|awesome|nice|perfect|cool|ok(ay)?|alright)\b[.!]*$/i,
  /^(bye|goodbye|see\s+ya|cya|good\s+night)[.!]*$/i,
  /^(who\s+are\s+you|what\s+are\s+you|what\s+can\s+you\s+do|what\s+is\s+your\s+name)[?.!]*$/i,
  /^(are\s+you\s+(there|online|real|human|an?\s+ai))[?.!]*$/i,
];

/** Verbs that signal an actionable coding/project/file/terminal request. */
const ACTION_VERBS =
  /\b(create|build|make|generate|scaffold|write|add|implement|develop|code|fix|debug|repair|patch|refactor|format|validate|scan|optimi[sz]e|rename|move|delete|remove|clean|organize|update|upgrade|improve|modify|edit|change|replace|substitute|swap|switch|insert|set|put|run|execute|launch|start|install|uninstall|test|lint|typecheck|build|compile|deploy|commit|push|initialize|init|setup|set\s?up|open|show|list|inspect|analy[sz]e|explain\s+(this|that|the)\s+(file|code|function|class|error)|find|search|check|karo|kar\s*do|kr\s*do|likho|likh\s*do|banao|banaao|bnao|bna\s*do|bana\s*do|lagao|laga\s*do|daalo|daal\s*do|jod\s*do|jodo|milao|mila\s*do|hatao|hata\s*do|chalao|chala\s*do|theek\s*karo|thik\s*karo|sudharo|behtar\s*karo|badal\s*do|badlo|rakho|badhao|kam\s*karo|apply\s*karo|implement\s*karo|remove\s*karo|add\s*karo|delete\s*karo|replace\s*karo|change\s*karo|update\s*karo|connect\s*karo|link\s*karo|edit\s*karo|fix\s*karo)\b/i;

/** Objects that make an action verb a workspace operation. */
const ACTION_OBJECTS =
  /\b(file|files|folder|folders|directory|directories|project|app|application|website|web\s?app|game|page|component|components|function|functions|class|classes|module|feature|login|auth|authentication|endpoint|api|database|schema|script|scripts|code|snippet|program|server|client|frontend|backend|test|tests|suite|package|dependencies|deps|config|configuration|error|errors|bug|bugs|warning|warnings|build|repo|repository|readme|css|html|html5|stylesheet|markup|javascript|js|typescript|ts|python|py|react|node|express|package\.json|src|workspace|terminal|command|commands|environment|env|calculator|calculater|editor|harness|plugin|widget|form)\b/i;

/** Explicit file-path references ("src/app.ts", "package.json", "the file X"). */
const FILE_REFERENCE =
  /(\b[\w-]+\.([cm]?js|jsx|ts|tsx|py|json|html|css|scss|md|txt|yaml|yml|toml|env|sh|ps1|bat|c|cpp|cs|java|go|rs|rb|php|sql|xml|vue|svelte)\b|\bthis\s+file\b|\bthat\s+file\b|\bcurrent\s+file\b|\bthe\s+file\b|\bsrc\/\S+)/i;

/** Command-runner phrasing. */
const COMMAND_PHRASES =
  /\b(run|execute|launch)\s+(the\s+)?(project|app|application|tests?|build|command|npm|node|python|script|server|dev|program)/i;

/** Terminal-y verbs that always mean the agent, even without a clear object. */
const STRONG_AGENT_PATTERNS: RegExp[] = [
  COMMAND_PHRASES,
  /\bnpm\s+(install|run|test|start|build)/i,
  /\bpip\s+install\b/i,
  /\bgit\s+(status|log|commit|push|pull|checkout|branch|add|diff|restore)/i,
  /\b(fix|resolve)\b.*\b(error|bug|issue|failure|crash|exception|traceback|failing)\b/i,
  /\b(error|bug|issue|failure|crash|exception|traceback|failing)\b.*\b(fix|resolve)\b/i,
  /\bfrom\s+scratch\b/i,
  /\b(create|make|build)\s+(me\s+)?(a|an|the|my|some)\s/i,
  /\b(replace|substitute|swap|switch)\b.*\b(with|to|for|by)\b/i,
  // Hinglish replacement requests: "X ki jagah Y", "X ke badle Y",
  // "X ko Y mein badal do". A romanized Hindi imperative is as strong a
  // coding signal as its English equivalent.
  /\b(?:ke?|ki)\s*(?:jagah|jagha|jaga|jagaha|badle)\b/i,
  /\bko\b[^.!?\n]{0,40}\b(?:me|mein)\b[^.!?\n]{0,24}\b(?:badal|bdl|badal\s*do)\b/i,
  /\b(?:karo|kar\s*do|kr\s*do|likho|likh\s*do|banao|banaao|bnao|bna\s*do|bana\s*do|lagao|laga\s*do|daalo|jod\s*do|jodo|milao|mila\s*do|hatao|hata\s*do|chalao|chala\s*do|theek\s*karo|thik\s*karo|sudharo|behtar\s*karo|badal\s*do|badlo)\b/i,
  /\b(?:now|please\s+)?(?:do\s+it|apply\s+it|apply\s+this|make\s+the\s+change|update\s+the\s+file)\b/i,
];

/** Pure conversational/question phrasing (with no action verb). */
const CHAT_PATTERNS: RegExp[] = [
  /\b(what\s+do\s+you\s+think|your\s+opinion|do\s+you\s+(think|like|believe|recommend))\b/i,
  /\b(give|offer)\s+me\s+(some\s+)?(advice|suggestions?|tips|feedback|thoughts|ideas)\b/i,
  /\b(advice|suggestions?|tips|feedback|opinions?)\s+(about|on|for)\b/i,
  /^(tell|explain|teach)\s+me\s+about\s+(?!.*\b(this|that|current)\b)/i,
  /^(what|who|when|where|why|how)\b[^\n]{0,80}?(concept|idea|principle|history|difference\s+between)\b/i,
  /\b(explain)\s+((python|java|c\+\+|javascript|typescript|sql|react|git)\b|classes|objects|functions|recursion|closures?|promises|async|inheritance|polymorphism|encapsulation|api|rest|docker)\b/i,
];

export interface IntentResult {
  kind: IntentKind;
  /** Human-readable reason shown in the activity log. */
  reason: string;
}

export interface IntentContext {
  /** A known project or recent project result makes terse follow-ups actionable. */
  hasProjectContext?: boolean;
  /** An open editor file makes terse file-specific edits actionable. */
  currentFile?: string;
}

export interface ConversationRouteContext extends IntentContext {
  /** The user-facing lock. Chat is always read-only; Agent still permits ordinary conversation. */
  conversationMode?: 'chat' | 'agent';
  /** Finer workflow tab such as ask, plan, debug or agent. */
  workflowMode?: string;
  approvedContinuation?: boolean;
  resumeRequested?: boolean;
  matchesRememberedProject?: () => boolean;
}

const CONTINUATION_ACTION =
  /\b(connect|link|wire|integrate|combine|merge|attach|join|continue|resume|finish|complete|apply|approve|approved|start|begin|work|proceed|move|add|update|edit|change|modify|style|script|implement|refactor|fix|repair|improve|upgrade|set|put|place|remove|replace|substitute|swap|switch|insert)\b|(?:जोड़|मिला|कनेक्ट|लिंक|बदल|अपडेट|ठीक|सुधार|करो|कर दो|लगा|लगाओ|लगा दो|डाल|डालो|डाल दो|रख|रखो|बना|बनाओ|बनाना|बनवाओ|बनवा|कर दो|शुरू|चलो|आगे|रिप्लेस|स्वैप)/i;
const CONTINUATION_ARTIFACT =
  /\b(this|these|both|same|existing|current|it|them|files?|html|css|stylesheet|script|javascript|markup|index|component|project|app|website|background|image|photo|asset|login|sign[ -]?in|auth|button|form|color|font|animation|navbar|hero|phase|task|work|changes?|feature|store|clone)\b/i;

/**
 * A short follow-up such as "now connect both files" has too little project
 * vocabulary to pass the ordinary action/object rules. When the UI already
 * has a project in memory, treat that imperative as a coding request. A
 * question such as "how do I connect CSS?" stays chat because it has no
 * imperative continuation verb.
 */
export function isProjectContinuation(text: string, context?: IntentContext): boolean {
  if (!context?.hasProjectContext && !context?.currentFile) return false;
  if (hasConversationalQuestionLead(text)) return false;
  if (/\b(?:now\s+|please\s+)?(?:replace|substitute|swap|switch)\b/i.test(text)) return true;
  // Romanized Hinglish continuation verbs and replacement phrasing.
  if (/\b(?:karo|kar\s*do|kr\s*do|likho|likh\s*do|banao|banaao|bnao|bna\s*do|bana\s*do|lagao|laga\s*do|daalo|jod\s*do|jodo|milao|mila\s*do|hatao|hata\s*do|chalao|chala\s*do|theek\s*karo|thik\s*karo|sudharo|behtar\s*karo|badal\s*do|badlo)\b/i.test(text)) return true;
  if (/\b(?:ke?|ki)\s*(?:jagah|jagha|jaga|jagaha|badle)\b/i.test(text)) return true;
  if (/\bko\b[^.!?\n]{0,40}\b(?:me|mein)\b[^.!?\n]{0,24}\b(?:badal|bdl|badal\s*do)\b/i.test(text)) return true;
  if (CONTINUATION_ACTION.test(text) && CONTINUATION_ARTIFACT.test(text)) return true;
  // In an open editor, terse styling/editing commands often omit the file
  // noun entirely ("upgrade CSS", "make it cleaner", "fix spacing"). Treat
  // those as edits to the selected file while keeping questions conversational.
  if (context.currentFile && (CONTINUATION_ACTION.test(text) || /^make\s+(?:it|this)\b/i.test(text)) &&
      /\b(css|style|styling|layout|spacing|color|colour|font|animation|responsive|visual|design|cleaner|polish|improve|better)\b|(?:सुधारो|बेहतर|सुंदर|स्टाइल|कलर|डिजाइन|एनिमेशन)/i.test(text)) return true;
  // When a file is selected, concise imperative edits like "improve it",
  // "make responsive", or "polish this" refer to that file even when they
  // omit a file noun or the type of change. Questions are filtered above.
  if (context.currentFile && /^(?:please\s+)?(?:make|improve|fix|clean|polish|simplify|optimi[sz]e|refactor|upgrade|update|change|rewrite|add|remove|tighten|improve)\b|^(?:इसे\s*)?(?:सुधारो|ठीक करो|बेहतर करो|पॉलिश करो|बदल दो|जोड़ो|हटाओ)/i.test(text)) return true;
  // Phase approvals and short hand-offs are still executable project work.
  // Keep plain acknowledgements such as “good” and “nice” in chat.
  return /\b(?:start|begin|continue|resume|work|proceed|move)\b[\s-]*(?:phase|task|work|it|now|next)?\s*\d*/i.test(text)
    || /\b(?:approved?|approval)\b.*\b(?:phase|task|work|next|start|continue)\b/i.test(text);
}

/**
 * Resolve the top-level Chat/Agent lock and the finer workflow together.
 * An explicit Chat lock always disables tools. An explicit Agent lock still
 * uses intent classification (so greetings/questions remain chat), but a
 * coding follow-up cannot be demoted by a stale Ask/Review sub-mode.
 */
export function routeConversationIntent(prompt: string, context: ConversationRouteContext = {}): IntentResult {
  const workflowMode = context.workflowMode || 'agent';
  if (context.conversationMode === 'chat') {
    return { kind: 'chat', reason: 'Explicit Chat mode lock' };
  }
  if (context.conversationMode !== 'agent' && ['ask', 'review', 'plan'].includes(workflowMode)) {
    return { kind: 'chat', reason: 'Read-only workflow selected' };
  }
  if (context.resumeRequested) {
    return { kind: 'agent', reason: 'Explicit checkpoint resume' };
  }
  if (context.approvedContinuation) {
    return { kind: 'agent', reason: 'Approved project continuation' };
  }
  if (context.conversationMode !== 'agent' && !['agent', 'analyze'].includes(workflowMode)) {
    return { kind: 'agent', reason: 'Explicit tool workflow selected' };
  }
  // Match the renderer's write-intent guard for concise selected-file edits.
  if (context.currentFile && isMutationRequest(prompt, { currentFile: context.currentFile })) {
    return { kind: 'agent', reason: 'Selected-file edit detected' };
  }
  const classification = classifyIntent(prompt, context);
  if (classification.kind === 'chat' && context.matchesRememberedProject && hasExplicitWorkspaceAction(prompt)) {
    try {
      if (context.matchesRememberedProject()) {
        return { kind: 'agent', reason: 'Action refers to a remembered project' };
      }
    } catch {
      // A failed memory lookup must not prevent the original chat reply.
    }
  }
  return classification;
}

/** Project memory may resolve the target of an action, never create the action itself. */
export function hasExplicitWorkspaceAction(prompt: string): boolean {
  const text = String(prompt || '').trim();
  if (hasConversationalQuestionLead(text) || CHAT_PATTERNS.some(pattern => pattern.test(text))) return false;
  return ACTION_VERBS.test(text) || STRONG_AGENT_PATTERNS.some(pattern => pattern.test(text)) ||
    /(?:बनाओ|बनाइए|बनाना|बना दो|ठीक करो|सुधारो|जोड़ो|जोड़ दो|बदल दो|हटाओ|चलाओ|लागू करो|कर दो)/i.test(text);
}

export function classifyIntent(prompt: string, context?: IntentContext): IntentResult {
  const text = (prompt || '').trim();

  if (!text) return { kind: 'chat', reason: 'Empty message' };
  if (/^(?:what|which)\s+(?:should|could|can)\s+(?:i|we)\b/i.test(text) &&
      !/\b(?:apply|implement)\b[\s\S]*\b(?:now|it|changes?)\b/i.test(text)) {
    return {kind:'chat', reason:'Request for suggestions'};
  }
  if (isProjectContinuation(text, context)) {
    return { kind: 'agent', reason: 'Continuation of the active project detected' };
  }
  // A question remains a chat request even when it mentions an editable
  // artifact (for example, "How do I improve CSS?"). Keep it ahead of the
  // generic action-verb/object rule below.
  if (hasConversationalQuestionLead(text)) {
    return { kind: 'chat', reason: 'Conversational question' };
  }
  if (/\b(scan|find|list|inspect|check)\b.*\b(TODOs?|FIXMEs?|symbols?|imports?|rules|whitespace|markdown)\b/i.test(text) ||
      /(?:फॉर्मेट|फॉर्मैट)\s*(?:करो|कर दो)/.test(text) && /(?:फाइल|फ़ाइल|कोड|\.\w{1,5}\b)/.test(text)) {
    return { kind: 'agent', reason: 'Coding plugin workspace action detected' };
  }
  if (/(?:बनाओ|बनाइए|बनाना|बना दो|ठीक करो|सुधारो|जोड़ो|जोड़ दो|बदल दो|हटाओ|चलाओ)/.test(text) &&
      /(?:कोड|फाइल|फ़ाइल|प्रोजेक्ट|ऐप|वेबसाइट|स्क्रिप्ट|सर्वर|बग|एरर|टेस्ट|फंक्शन|एपीआई|API|CLI|\.py|\.ts|\.js)/i.test(text)) {
    return { kind: 'agent', reason: 'Hindi workspace action detected' };
  }

  // 1. Unambiguous greetings & small talk are always plain chat.
  for (const pattern of GREETING_PATTERNS) {
    if (pattern.test(text)) {
      return { kind: 'chat', reason: 'Greeting / small talk' };
    }
  }

  // 2. Strong agent signals (commands, error fixing, "from scratch", "create a …").
  for (const pattern of STRONG_AGENT_PATTERNS) {
    if (pattern.test(text)) {
      return { kind: 'agent', reason: 'Action / project / command request' };
    }
  }

  // 3. Known conversational phrasing → chat. This check runs BEFORE the
  //    action-verb rule because words like "code" appear in both lists
  //    ("Give me some tips about my code" is a conversation, not a tool call).
  for (const pattern of CHAT_PATTERNS) {
    if (pattern.test(text)) {
      return { kind: 'chat', reason: 'Conversational question' };
    }
  }

  // 4. Action verb + concrete object → agent.
  if (ACTION_VERBS.test(text) && ACTION_OBJECTS.test(text)) {
    return { kind: 'agent', reason: 'Workspace action detected' };
  }

  // 5. Explicit file references → agent (read/edit that file).
  if (FILE_REFERENCE.test(text) && ACTION_VERBS.test(text)) {
    return { kind: 'agent', reason: 'File operation detected' };
  }
  if (/\b(open|show|explain|check|review|analy[sz]e)\b/i.test(text) && FILE_REFERENCE.test(text)) {
    return { kind: 'agent', reason: 'File reference detected' };
  }

  // 6. Short message with no action verb → chat.
  const wordCount = text.split(/\s+/).length;
  const hasActionVerb = ACTION_VERBS.test(text);
  if (!hasActionVerb && wordCount <= 25) {
    return { kind: 'chat', reason: 'Conversational message' };
  }

  // 7. Long/detailed technical message with action verbs and objects → agent;
  //    otherwise default to chat (never fire tools on ambiguity).
  if (hasActionVerb && ACTION_OBJECTS.test(text)) {
    return { kind: 'agent', reason: 'Coding task detected' };
  }
  if (hasActionVerb && wordCount >= 10 && /\b(code|function|class|api|component|feature)\b/i.test(text)) {
    return { kind: 'agent', reason: 'Coding task detected' };
  }

  return { kind: 'chat', reason: 'No workspace action detected' };
}
