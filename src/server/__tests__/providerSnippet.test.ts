import { describe, expect, it } from 'vitest';
import { parseProviderSnippet } from '../../shared/providerSnippet.js';

describe('provider snippet importer', () => {
  it('reads the documented Python requests shape without executing it', () => {
    const result = parseProviderSnippet(`import requests
invoke_url = "https://api.example.com/v1/chat/completions"
headers = {"Authorization": "Bearer sk-example", "Content-Type": "application/json"}
payload = {"model": "example-coder", "max_tokens": 1024}
requests.post(invoke_url, headers=headers, json=payload, stream=False)`);
    expect(result).toMatchObject({ endpoint: 'https://api.example.com/v1/chat/completions', model: 'example-coder', protocol: 'openai', auth: 'bearer', secret: 'sk-example', streaming: false });
  });

  it('recognizes x-api-key and rejects dynamic or incomplete snippets', () => {
    expect(parseProviderSnippet(`invoke_url = 'https://api.anthropic.com/v1/messages'
headers = {'x-api-key': 'secret'}
payload = {'model': 'claude-test'}`)).toMatchObject({ protocol: 'anthropic', auth: 'header', header: 'x-api-key' });
    expect(() => parseProviderSnippet('requests.post(invoke_url, json=payload)')).toThrow(/literal invoke_url|model/i);
  });
});
