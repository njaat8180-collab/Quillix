export type ImportedProviderSnippet = {
  endpoint: string;
  model: string;
  protocol: 'openai' | 'responses' | 'anthropic' | 'gemini';
  auth: 'bearer' | 'header' | 'basic' | 'none';
  header?: string;
  secret?: string;
  streaming?: boolean;
};

function assignment(source: string, name: string): string | undefined {
  const match = source.match(new RegExp(`(?:^|\\n)\\s*${name}\\s*=\\s*(["'])(.*?)\\1`, 's'));
  return match?.[2]?.trim() || undefined;
}

function objectValue(source: string, key: string): string | undefined {
  const match = source.match(new RegExp(`(?:["']${key}["']|\\b${key}\\b)\\s*:\\s*(["'])(.*?)\\1`, 's'));
  return match?.[2]?.trim() || undefined;
}

/** Import literal provider-doc fields without evaluating or executing pasted code. */
export function parseProviderSnippet(input: string): ImportedProviderSnippet {
  if (typeof input !== 'string' || input.trim().length < 20 || input.length > 200_000) {
    throw new Error('Paste the complete provider requests snippet (up to 200,000 characters).');
  }
  const source = input.replace(/\r/g, '');
  const endpoint = assignment(source, 'invoke_url') || source.match(/requests\.post\(\s*(["'])(https?:\/\/[^"']+)\1/i)?.[2];
  const model = objectValue(source, 'model');
  if (!endpoint) throw new Error('Could not find a literal invoke_url or requests.post URL.');
  if (!model) throw new Error('Could not find a literal payload model ID.');
  let protocol: ImportedProviderSnippet['protocol'] = 'openai';
  if (/anthropic\.com/i.test(endpoint) || /messages\s*:/i.test(source)) protocol = 'anthropic';
  else if (/generativelanguage\.googleapis\.com|generateContent/i.test(endpoint + source)) protocol = 'gemini';
  else if (/responses/i.test(endpoint) && /responses/i.test(source)) protocol = 'responses';
  const streaming = /\bstream\s*=\s*true|["']stream["']\s*:\s*true/i.test(source);
  const authorization = source.match(/(?:["']authorization["']|\bauthorization\b)\s*:\s*(["'])bearer\s+([^"']+)\1/i);
  if (authorization?.[2]) return { endpoint: endpoint.replace(/\/+$/, ''), model, protocol, auth: 'bearer', secret: authorization[2].trim(), streaming };
  const apiKey = source.match(/(?:["'](?:x-api-key|api-key|api_key)["']|\b(?:x-api-key|api-key|api_key)\b)\s*:\s*(["'])(.*?)\1/i);
  if (apiKey?.[2]) return { endpoint: endpoint.replace(/\/+$/, ''), model, protocol, auth: 'header', header: apiKey[0].toLowerCase().includes('x-api-key') ? 'x-api-key' : 'api-key', secret: apiKey[2].trim(), streaming };
  return { endpoint: endpoint.replace(/\/+$/, ''), model, protocol, auth: 'none', streaming };
}
