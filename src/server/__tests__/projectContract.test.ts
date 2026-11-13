import { describe, it, expect } from 'vitest';
import { requiredProjectFiles, isPlainWebsiteRequest, isSingleFileCreationRequest } from '../projectContract.js';
import { validateLocalApiRequest } from '../localRequestSecurity.js';

describe('New project completion contract', () => {
  it('requires separate assets for a plain website', () => {
    expect(requiredProjectFiles('Build a calculator website')).toEqual(['index.html', 'style.css', 'script.js']);
  });
  it('recognizes an HTML CSS JS stack and limits an approval-gated first stage to HTML', () => {
    expect(isPlainWebsiteRequest('create a youtube clone using html css js only frantand')).toBe(true);
    expect(requiredProjectFiles('create a callculater using html css js')).toEqual(['index.html', 'style.css', 'script.js']);
    const staged = 'create a youtube clone using html css js only frantand first write html file and when i approve than work on other langvage';
    expect(isSingleFileCreationRequest(staged)).toBe(true);
    expect(requiredProjectFiles(staged)).toEqual(['index.html']);
  });
  it('does not turn file references in a scoped follow-up into a whole-website task', () => {
    expect(isPlainWebsiteRequest('Add an app.js click handler, link it from index.html, and do not modify style.css.')).toBe(false);
    expect(isPlainWebsiteRequest('मौजूदा sign-in button के लिए app.js में click handler बनाओ, उसे index.html में link करो और style.css मत बदलो।')).toBe(false);
  });
  it('respects the specified files and does not force other languages into a template', () => {
    expect(requiredProjectFiles('Create app.py and settings.json')).toEqual(['app.py', 'settings.json']);
    expect(requiredProjectFiles('Create src/index.js and tests/index.js')).toEqual(['src/index.js', 'tests/index.js']);
    expect(requiredProjectFiles('Create a React website')).toEqual([]);
    expect(requiredProjectFiles('Make a single-file website')).toEqual(['index.html']);
    expect(requiredProjectFiles('Put all CSS and JavaScript in one HTML file')).toEqual(['index.html']);
    expect(requiredProjectFiles('Create file named test.html', true)).toEqual(['test.html']);
  });
});

describe('Local API boundary', () => {
  it('accepts same-origin clients and native clients on the configured port', () => {
    expect(validateLocalApiRequest('127.0.0.1:3000', undefined, 3000)).toBe(true);
    expect(validateLocalApiRequest('127.0.0.1:3000', 'http://localhost:3000', 3000)).toBe(true);
    expect(validateLocalApiRequest('localhost:5000', 'http://localhost:5000', 5000)).toBe(true);
  });
  it('rejects cross-origin requests and DNS rebinding attempts', () => {
    expect(validateLocalApiRequest('malicious.example:3000', undefined, 3000)).toBe(false);
    expect(validateLocalApiRequest('127.0.0.1:3000', 'https://malicious.example', 3000)).toBe(false);
    expect(validateLocalApiRequest('127.0.0.1:3000', 'null', 3000)).toBe(false);
    expect(validateLocalApiRequest('127.0.0.1:3000', 'http://localhost:3001', 3000)).toBe(false);
  });
});
