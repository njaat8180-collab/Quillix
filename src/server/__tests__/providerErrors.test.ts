import { describe, expect, it } from 'vitest';
import { safeProviderError } from '../providerErrors.js';

describe('safe provider error mapping', () => {
  it('preserves HTTP status and retry context without upstream bodies', () => {
    expect(safeProviderError('Universal API returned HTTP 429 after 2 retries. Retry later or check provider quota.', 'Grok'))
      .toMatch(/Grok API returned HTTP 429 after 2 retries/);
    expect(safeProviderError('Universal API returned HTTP 401. Check endpoint, model name, access and credits.', 'OpenAI'))
      .toMatch(/OpenAI API rejected the saved API key \(HTTP 401\)/);
  });

  it('preserves the actionable 413 context-limit message', () => {
    const message = safeProviderError('Universal API rejected this request as too large (HTTP 413). Reduce selected files/context.', 'Universal');
    expect(message).toMatch(/HTTP 413/);
    expect(message).toMatch(/Reduce selected files\/context/);
  });

  it('explains retired or unavailable models instead of blaming the API key', () => {
    expect(safeProviderError('Universal API returned HTTP 410. Check endpoint, model name, access and credits.', 'NVIDIA NIM'))
      .toMatch(/no longer serves the selected model.*HTTP 410/i);
  });

  it('maps timeout/network failures and never echoes unknown upstream text', () => {
    expect(safeProviderError('Could not reach Universal API endpoint. Check URL.', 'Groq'))
      .toMatch(/Could not reach Groq API endpoint/);
    expect(safeProviderError('provider leaked secret=abc', 'Grok'))
      .toBe('Grok connection failed. Check the API key, model access, credits and network.');
  });
});
