/** Convert adapter failures into useful, secret-free connection-test messages. */
export function safeProviderError(rawMessage: unknown, provider: string): string {
  const raw = String(rawMessage || 'Connection failed.').trim();
  const label = `${provider} API`;
  if (/^Universal API returned HTTP \d+(?: after \d+ retries)?\./i.test(raw)) {
    const status = raw.match(/HTTP (401|403|410)\b/i)?.[1];
    if (status === '410') return `${label} no longer serves the selected model (HTTP 410). Choose a current model from the provider catalog and try again.`;
    if (status) return `${label} rejected the saved API key (HTTP ${status}). Re-enter the key and verify that this account can access the selected model.`;
    return raw.replace(/^Universal API/i, label);
  }
  if (/^Universal API rejected this request as too large/i.test(raw)) {
    return raw.replace(/^Universal API/i, label);
  }
  if (/^Universal API request cancelled or timed out/i.test(raw)) {
    return `${provider} request was cancelled or timed out. Check the provider response time and try again.`;
  }
  if (/^Could not reach Universal API endpoint/i.test(raw)) {
    return `Could not reach ${label} endpoint. Check the URL, internet connection and provider status.`;
  }
  if (/^Universal API returned (?:an empty response|no text or tool calls)/i.test(raw) || /^empty$/i.test(raw)) {
    return `${provider} returned no usable response; connection is not verified.`;
  }
  return `${provider} connection failed. Check the API key, model access, credits and network.`;
}
