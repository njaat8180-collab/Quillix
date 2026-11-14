import { randomUUID } from 'node:crypto';

export type SensitiveValueMap = Map<string, string>;

function redact(content: string, mask: (value: string, kind: string) => string): string {
  return content
    .replace(/AIza[0-9A-Za-z_-]{35}/g, value => mask(value, 'API_KEY'))
    .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, value => mask(value, 'AWS_ACCESS_KEY'))
    .replace(/\bsk_(?:live|test|proj)_[A-Za-z0-9_-]{16,}\b/gi, value => mask(value, 'PROVIDER_KEY'))
    // OpenAI-style keys are hyphenated, not underscored: "sk-<48 chars>",
    // "sk-proj-<...>", "sk-svcacct-<...>". Without this, a key stored in a
    // variable whose name does not look secret-like (e.g. `openaiKey`) would be
    // pasted verbatim into an AI prompt.
    .replace(/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g, value => mask(value, 'PROVIDER_KEY'))
    .replace(/\bgsk_[A-Za-z0-9_-]{16,}\b/gi, value => mask(value, 'PROVIDER_KEY'))
    .replace(/\bhf_[A-Za-z0-9]{20,}\b/g, value => mask(value, 'PROVIDER_KEY'))
    .replace(/\bgh[pousr]_[0-9A-Za-z]{20,}\b/g, value => mask(value, 'GITHUB_TOKEN'))
    .replace(/\bglpat-[A-Za-z0-9_-]{20,}\b/g, value => mask(value, 'GITLAB_TOKEN'))
    .replace(/\bnpm_[A-Za-z0-9]{20,}\b/g, value => mask(value, 'NPM_TOKEN'))
    .replace(/\bxox[baprs]-[0-9A-Za-z-]{20,}\b/g, value => mask(value, 'SLACK_TOKEN'))
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, value => mask(value, 'PRIVATE_KEY'))
    .replace(/(\b(?:authorization)\s*[:=]\s*['"]?Bearer\s+)([^\s'"`,}]+)/gi, (_match, prefix: string, value: string) => `${prefix}${mask(value, 'CREDENTIAL')}`)
    .replace(/(['"]?\b(?:api[_-]?key|client[_-]?secret|secret(?:[_-]?(?:access[_-]?)?key)?|private[_-]?key|password|passwd|credential|token|access[_-]?token|refresh[_-]?token|auth[_-]?token|access[_-]?key|bearer)\b['"]?\s*[:=]\s*['"]?)(?!\[REDACTED_|__QUILLIX_SECRET_)([^\s'"`,}]{8,})/gi,
      (_match, prefix: string, value: string) => `${prefix}${mask(value, 'CREDENTIAL')}`);
}

/** Redact common credential formats before source snippets enter an AI prompt. */
export function redactSensitiveText(content: string): string {
  return redact(content, (_value, kind) => {
    if (kind === 'CREDENTIAL') return '[REDACTED]';
    if (kind === 'PRIVATE_KEY') return '[REDACTED_PRIVATE_KEY]';
    return `[REDACTED_${kind}]`;
  });
}

/**
 * Redact content for an agent read while retaining opaque, per-read handles.
 * The handles let a later write/edit restore unchanged values without ever
 * returning the original credentials to the model.
 */
export function redactSensitiveTextForRoundTrip(content: string, previousValues?: SensitiveValueMap): { content: string; values: SensitiveValueMap } {
  const values: SensitiveValueMap = new Map();
  const previousMarkers = new Map<string, string>();
  for (const [marker, value] of previousValues || []) previousMarkers.set(value, marker);
  const redacted = redact(content, (value, kind) => {
    const marker = previousMarkers.get(value) || `__QUILLIX_SECRET_${kind}_${randomUUID().replace(/-/g, '')}__`;
    values.set(marker, value);
    return marker;
  });
  return { content: redacted, values };
}

export function restoreSensitiveValues(content: string, values: SensitiveValueMap): {
  content: string;
  missing: string[];
} {
  const missing: string[] = [];
  let restored = content;
  for (const [marker, value] of values) {
    if (!restored.includes(marker)) missing.push(marker);
    else restored = restored.split(marker).join(value);
  }
  return { content: restored, missing };
}
