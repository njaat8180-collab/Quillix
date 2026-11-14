import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KnowledgeBase } from '../knowledgeBase.js';

describe('offline coding knowledge retrieval', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-knowledge-'));
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({
      version: 1,
      documents: [{
        file: 'react.md', title: 'React guide', source: 'https://react.dev', license: 'test', tags: ['react', 'component'],
      }],
    }));
    fs.writeFileSync(path.join(root, 'react.md'), '# React\nUse components and keep state close to the UI.');
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('retrieves only relevant bundled guidance with attribution', () => {
    const result = new KnowledgeBase([root]).retrieve('build a React component', { maxChars: 600 });
    expect(result.files).toEqual(['react.md']);
    expect(result.context).toContain('React guide');
    expect(result.context).toContain('https://react.dev');
  });

  it('does not inject unrelated guidance', () => {
    const result = new KnowledgeBase([root]).retrieve('write a Rust parser');
    expect(result.files).toEqual([]);
    expect(result.context).toBe('');
  });
});
