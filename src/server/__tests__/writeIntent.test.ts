import { describe, expect, it } from 'vitest';
import { isMutationRequest } from '../../shared/writeIntent.js';

describe('editor mode write guard', () => {
  it('promotes explicit coding actions', () => {
    expect(isMutationRequest('Fix the bug in this file')).toBe(true);
    expect(isMutationRequest('now replace hello with high')).toBe(true);
    expect(isMutationRequest('replace hello with hi')).toBe(true);
    expect(isMutationRequest('Now replace "Hello World" with "Hello" in index.html file.')).toBe(true);
    expect(isMutationRequest('इस file में code जोड़ दो')).toBe(true);
  });

  it('promotes romanized Hinglish replacement requests (no Devanagari present)', () => {
    // Reported defect: "hello ki jagah hi kar do" was classified as chat, so
    // the edit silently turned into a conversational refusal instead of a
    // real file change. These requests carry no Devanagari at all.
    for (const prompt of [
      'hello ki jagah hi likh do',
      'us website me hello ki jagah high kar do',
      'is website me hello ko high me badal do',
      'hello badal ke high kar do',
      'ab jo iske andar ye hello ki jagah hi likh do',
    ]) {
      expect(isMutationRequest(prompt), prompt).toBe(true);
      expect(isMutationRequest(prompt, { currentFile: 'index.html' }), prompt).toBe(true);
    }
  });

  it('promotes romanized Hinglish imperative verbs', () => {
    for (const prompt of ['CSS improve karo', 'button jod do', 'footer me copyright likh do', 'background me image lagao', 'font size badhao']) {
      expect(isMutationRequest(prompt), prompt).toBe(true);
    }
  });

  it('keeps romanized Hinglish questions read-only', () => {
    for (const prompt of ['CSS kya hai?', 'Ise sundar kaise banaun?', 'kaise karein ye kaam?', 'kya kar sakta hai tu']) {
      expect(isMutationRequest(prompt), prompt).toBe(false);
      expect(isMutationRequest(prompt, { currentFile: 'index.html' }), prompt).toBe(false);
    }
  });

  it('keeps questions and plans read-only', () => {
    expect(isMutationRequest('Explain the architecture of this project')).toBe(false);
    expect(isMutationRequest('Plan how we should build the editor')).toBe(false);
  });

  it('promotes terse edits when an editor file is selected', () => {
    const context = {currentFile: 'src/styles.css'};
    for (const prompt of ['upgrade CSS', 'improve styling', 'make it cleaner', 'fix spacing', 'CSS सुधारो', 'more animations', 'less whitespace', 'mobile friendly', 'dark theme', 'rounded corners', 'थोड़ा और अच्छा कर दो', 'इसे सुंदर बनाओ', 'और animations डालो']) {
      expect(isMutationRequest(prompt, context), prompt).toBe(true);
    }
    expect(isMutationRequest('more animations')).toBe(false);
  });

  it('recognizes concise Hindi design changes without treating questions as edits', () => {    const context = {currentFile: 'src/App.tsx'};
    for (const prompt of ['background में image लगा दो', 'इसमें login button जोड़ो', 'थोड़ा और responsive कर दो']) {
      expect(isMutationRequest(prompt, context), prompt).toBe(true);
    }
    for (const prompt of ['CSS क्या है?', 'इसे सुंदर कैसे बनाऊँ?', 'थोड़ा और अच्छा क्यों है?']) {
      expect(isMutationRequest(prompt, context), prompt).toBe(false);
    }
  });

  it('does not let incidental question words demote a concrete selected-file edit', () => {
    expect(isMutationRequest('I know how this works; improve the CSS.', {currentFile: 'src/styles.css'})).toBe(true);
  });

  it('keeps editor-related questions read-only even when a file is selected', () => {
    const context = {currentFile: 'src/styles.css'};
    expect(isMutationRequest('How do I improve CSS?', context)).toBe(false);
    expect(isMutationRequest('How do I fix it?', context)).toBe(false);
    expect(isMutationRequest('Give me tips to fix the website', context)).toBe(false);
    expect(isMutationRequest('What is CSS?', context)).toBe(false);
  });
});
