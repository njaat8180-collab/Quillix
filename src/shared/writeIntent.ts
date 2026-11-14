export interface WriteIntentContext {
  /** A selected editor file makes concise edit requests actionable. */
  currentFile?: string | null;
}

/** Detects codebase questions ("where is X defined?", "what does Y do?") that should use the M1.4 codebase Q&A endpoint. */
export function isCodebaseQuestion(prompt: string): boolean {
  const text = String(prompt || "").trim().toLowerCase();
  if (!text) return false;
  return /^(?:where|what|which)\b.*\b(?:defined|definition|implemented|located|declared|file)\b/i.test(text) ||
    /\b(?:where is|where are|what is|what does)\b.*\b(?:function|class|interface|type|const|variable|method|symbol|variable|export)\b/i.test(text) ||
    /\b(?:show me|find|locate)\b.*\b(?:definition|implementation|declaration|where)\b/i.test(text);
}

export function hasConversationalQuestionLead(prompt: string): boolean {
  return /^(?:please\s+)?(?:how|why|what|when|where|can you explain|tell me|(?:give|offer)\s+me\s+(?:some\s+)?(?:advice|suggestions?|tips|feedback|thoughts|ideas))\b/i.test(prompt.trim()) ||
    // Romanized (Hinglish) question leads. "CSS kya hai?" and "ise kaise banaun?"
    // ask for guidance, so they must never be promoted to a file write.
    /^(?:please\s+|zara\s+|thoda\s+|thodi\s+)*(?:kya|kaise|kaisi|kyu|kyun|kyun\w*|kab|kahan|kaun|kitna|kiti|kitne)\b/i.test(prompt.trim());
}

/** Detects implementation requests before the UI chooses a read-only workflow. */
export function isMutationRequest(prompt: string, context?: WriteIntentContext): boolean {
  const text = String(prompt || "").trim();
  if (!text || hasConversationalQuestionLead(text)) return false;
  // Romanized Hinglish questions place the interrogative after the subject
  // ("CSS kya hai?", "ye kaam kaise karein?"), so a lead-only check misses
  // them and they would be promoted to a file write. A terminal "?" plus a
  // romanized interrogative marks the message as asking, not doing.
  if (/\?\s*$/.test(text) && /\b(?:kya|kaise|kaisi|kyu|kyun|kab|kahan|kaun|kitna|kitni|kitne|kahaan|kaisay)\b|\b(?:hai|hain|haan|hu)\?$/i.test(text)) return false;
  const readOnlyLead = /^(?:please\s+)?(?:plan|planning|explain|review|analy[sz]e)\b/i.test(text);
  if (readOnlyLead && !/\b(?:apply|implement|fix\s+it|do\s+it|make\s+it|build\s+it|change\s+it|update\s+it)\b/i.test(text) &&
      !/(करो|कर दो|बना दो|ठीक करो|लागू|जोड़ दो|बदल दो)/.test(text)) return false;
  const explicitAction = /\b(create|build|make|write|add|implement|develop|fix|debug|repair|patch|refactor|edit|change|modify|update|upgrade|improve|polish|style|optimi[sz]e|delete|remove|rename|run|execute|test|lint|format|scaffold|generate|connect|link|wire|integrate|combine|merge|attach|continue|resume|start|begin|proceed|approve|approved|phase|work|replace|substitute|swap|switch|insert|set|put)\b/i.test(text) ||
    /(बनाओ|बना दो|बनाना|लिखो|जोड़ो|जोड़ दो|मिलाओ|मिला दो|कनेक्ट करो|लिंक करो|ठीक करो|सुधारो|बेहतर करो|पॉलिश करो|स्टाइल करो|फिक्स करो|बदल दो|हटाओ|चलाओ|लागू करो|इम्प्लीमेंट|लगाओ|लगा दो|डालो|बढ़ाओ|कम करो|रखो|बदलो|रिप्लेस|चेंज|स्वैप)/.test(text) ||
    // Romanized (Hinglish) imperative verbs. Users type these in Latin
    // script ("hello ki jagah hi kar do"), so the Devanagari-only list
    // above never matches them and the edit falls through to a chat reply.
    /\b(?:banao|banaao|bnao|bna\s*do|bana\s*do|likh\s*do|likho|jod\s*do|jodo|milao|mila\s*do|theek\s*karo|thik\s*karo|sudharo|behtar\s*karo|badal\s*do|badlo|badal|hatao|hata\s*do|chalao|chala\s*do|lagao|laga\s*do|daalo|badhao|kam\s*karo|rakho|karo|kar\s*do|kr\s*do|apply\s*karo|implement\s*karo|remove\s*karo|add\s*karo|delete\s*karo|replace\s*karo|change\s*karo|update\s*karo|connect\s*karo|link\s*karo|edit\s*karo|fix\s*karo|chalo|chalado)\b/i.test(text) ||
    // Replacement phrasing unique to Hinglish: "X ki jagah Y" (X's place
    // becomes Y), "X ke badle Y", "X ko Y mein badal do".
    /\b(?:ke?|ki)\s*(?:jagah|jagha|jaga|jagaha|badle)\b|\bko\b[^.!?\n]{0,40}\b(?:me|mein)\b[^.!?\n]{0,24}\b(?:badal|bdl|badal\s*do)\b/i.test(text);
  if (explicitAction) return true;

  if (context?.currentFile) {
    return /\b(?:make\s+(?:it|this)\s+(?:better|cleaner)|improve\s+(?:it|this)|fix\s+(?:the\s+)?(?:spacing|layout|styling)|(?:css|style|styling|layout|spacing|color|colour|font|animation|responsive|visual|design)\s+(?:better|cleaner|polish(?:ed)?|improv(?:e|ed)|upgrad(?:e|ed))?)\b|(?:इसे\s*(?:और\s*)?(?:बेहतर|सुंदर|साफ)\s+(?:करो|कर दो|बना दो)|स्पेसिंग\s*(?:ठीक करो|सुधारो)|(?:सीएसएस|स्टाइल)\s*(?:सुधारो|बेहतर करो))/i.test(text) ||
      /^(?:more|less|bigger|smaller|stronger|softer|cleaner|simpler|better|modern|responsive|dark|light)\s+(?:animations?|motion|whitespace|spacing|padding|margin|contrast|shadows?|corners?|typography|fonts?|colors?|colours?|layout|styles?|theme|design|on\s+mobile)\b|^(?:mobile[ -]friendly|rounded\s+corners|glassmorphism|dark\s+theme|light\s+theme|mobile\s+layout|stronger\s+hierarchy)$/i.test(text) ||
      /^(?:(?:(?:थोड़ा|जरा|और|थोड़ा\s+और)\s*)*(?:बेहतर|अच्छा|सुंदर|साफ|क्लीन|मॉडर्न|रिस्पॉन्सिव|आकर्षक)(?:\s+(?:करो|कर दो|बना दो|दिखाओ))?|(?:इसे|इसको)\s*(?:और\s*)?(?:बेहतर|सुंदर|साफ)\s+(?:करो|कर दो|बना दो))$/i.test(text) ||
      /^(?:(?:थोड़ा|जरा|और|इसे|इसमें)\s*)*(?:responsive|css|styles?|animations?|design|layout|background|image|login|button)(?:\s+.*)?\s+(?:करो|कर दो|लगाओ|लगा दो|डालो|बढ़ाओ|जोड़ो|जोड़ दो)$/i.test(text) ||
      /^(?:(?:इसमें|इसका|इसके|background|bg|बैकग्राउंड|image|इमेज|लॉगिन|login|button|बटन|animation|एनीमेशन|style|स्टाइल)\s+)+(?:.*\s+)?(?:लगाओ|लगा दो|डालो|जोड़ो|जोड़ दो|बढ़ाओ|कम करो|रखो|करो|कर दो)$/i.test(text);
  }
  return false;
}