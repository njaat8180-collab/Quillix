import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Accessibility regression contract: a fresh user who enabled the OS
// "prefers-reduced-motion" preference must not be forced into full animation.
// Motion (the library) already honors it via `reducedMotion="user"` at the
// default level, but the CSS-level ambient effects (orbs, particles,
// gradients, scroll reveals) are only suppressed when the app's animation
// level is "off". This fails on any tree that hard-defaults the level to
// "full" without first consulting the OS preference.
const project = path.resolve(process.env.QUILLIX_CONTRACT_ROOT || path.resolve(import.meta.dirname, '../..'));
const prefs = fs.readFileSync(path.join(project, 'src/animations/preferences.tsx'), 'utf8');
const main = fs.readFileSync(path.join(project, 'src/main.tsx'), 'utf8');

function check(name, ok) {
  assert.ok(ok, `reduced-motion contract: ${name}`);
}

const QUERY = "window.matchMedia('(prefers-reduced-motion: reduce)')";
check('the default level consults the OS reduce-motion preference', prefs.includes(QUERY));
check('a reduce-motion system resolves the default to "off" (suppresses CSS ambient effects too)',
  prefs.includes("return 'off';") && prefs.indexOf(QUERY) < prefs.indexOf("return 'off';"));
check('an explicit stored level is read before the OS fallback (a real choice still wins)',
  prefs.includes('localStorage.getItem(FALLBACK_KEY)') && prefs.indexOf('localStorage.getItem(FALLBACK_KEY)') < prefs.indexOf(QUERY));
check('the matchMedia lookup is feature-guarded so tests/SSR never throw', prefs.includes("typeof window.matchMedia === 'function'"));
check('motion stays animation-level-aware at the default', main.includes("reducedMotion={level === 'full' ? 'user' : 'always'}"));
check('motion skips entirely when the level is off', main.includes("skipAnimations={level === 'off'}"));

console.log(JSON.stringify({ status: 'PASS', files: ['src/animations/preferences.tsx', 'src/main.tsx'], checks: 6 }));