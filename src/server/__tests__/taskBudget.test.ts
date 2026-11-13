import { describe, expect, it } from 'vitest';
import { taskBudget } from '../taskBudget.js';

describe('token-focused task budgets', () => {
  it('keeps a short two-file repair focused even when verification is requested', () => {
    const budget = taskBudget(
      'Fix src/money.cjs and src/checkout.cjs, then run the configured tests.',
      false,
    );
    expect(budget.focused).toBe(true);
    expect(budget.contextWindow).toBe(6144);
    expect(budget.maxOutputTokens).toBe(2560);
  });

  it('does not focus broad multi-file architecture work', () => {
    const budget = taskBudget(
      'Refactor the entire architecture across src/app.ts, src/api.ts, src/db.ts and src/auth.ts with tests.',
      false,
    );
    expect(budget.focused).toBe(false);
    expect(budget.contextWindow).toBe(12288);
  });

  it('keeps an unscoped project prompt broad enough for conversational recovery', () => {
    const budget = taskBudget('Help me build a car game using Python', false);
    expect(budget.focused).toBe(false);
    expect(budget.maxTurns).toBe(10);
  });

  it('gives a rich single-file website enough bounded output for inline CSS and JS', () => {
    const budget = taskBudget(
      'Create a futuristic desktop website with an animated taskbar, Start menu, draggable windows, widgets, notifications, themes, responsive design, and put all CSS and JavaScript in one HTML file.',
      true,
    );
    expect(budget.focused).toBe(true);
    expect(budget.maxOutputTokens).toBe(6144);
    expect(budget.contextWindow).toBe(8192);
  });

  it('uses a compact but recoverable envelope for public long-horizon tasks', () => {
    const previous = process.env.QUILLIX_PUBLIC_BENCHMARK;
    process.env.QUILLIX_PUBLIC_BENCHMARK = '1';
    try {
      const budget = taskBudget('Fix the existing repository issue and run the configured acceptance command.', false);
      expect(budget.focused).toBe(true);
      expect(budget.contextChars).toBe(8500);
      expect(budget.contextWindow).toBe(8192);
      expect(budget.maxTurns).toBe(8);
      expect(budget.repairAttempts).toBe(4);
    } finally {
      if (previous === undefined) delete process.env.QUILLIX_PUBLIC_BENCHMARK;
      else process.env.QUILLIX_PUBLIC_BENCHMARK = previous;
    }
  });
});
