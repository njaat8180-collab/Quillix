import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { inspectBrowserScripts, checkExplicitWebRequirements, type BrowserIssue } from '../../src/server/browserChecks.js';

type Listener = (event?: unknown) => void;

class FakeElement {
  public value = '';
  public hidden = false;
  public textContent = '';
  public innerHTML = '';
  public style: Record<string, string> = {};
  public children: FakeElement[] = [];
  public listeners = new Map<string, Listener[]>();
  public classList = { add: (..._names: string[]) => undefined, remove: (..._names: string[]) => undefined };

  constructor(public tagName: string, public id = '', public className = '', private attributes: Record<string, string> = {}) {}

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }

  dispatchEvent(event: { type: string }) {
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
  }

  click() { this.dispatchEvent({ type: 'click' }); }
  getAttribute(name: string) { return this.attributes[name] ?? null; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  appendChild(child: FakeElement) { this.children.push(child); return child; }
}

function htmlElements(html: string): FakeElement[] {
  const elements: FakeElement[] = [];
  const tags = /<([a-z][\w-]*)(\s[^>]*?)?>/gi;
  let match: RegExpExecArray | null;
  while ((match = tags.exec(html))) {
    const attrs = match[2] || '';
    const id = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    const className = attrs.match(/\bclass\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    const attributes: Record<string, string> = {};
    for (const attr of attrs.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)) attributes[attr[1]] = attr[2];
    elements.push(new FakeElement(match[1].toLowerCase(), id, className, attributes));
  }
  return elements;
}

function simpleMatch(element: FakeElement, selector: string): boolean {
  if (/^#[\w:-]+$/.test(selector)) return element.id === selector.slice(1);
  if (/^\.[\w-]+$/.test(selector)) return element.className.split(/\s+/).includes(selector.slice(1));
  if (/^[a-z][\w-]*$/i.test(selector)) return element.tagName === selector.toLowerCase();
  return false;
}

function createRuntime(html: string) {
  const elements = htmlElements(html);
  const categorySelect = elements.find(element => element.id === 'category-select');
  if (categorySelect) categorySelect.value = 'all';
  const storage = new Map<string, string>();
  const document = {
    addEventListener(type: string, listener: Listener) {
      if (type === 'DOMContentLoaded') listener({ type });
    },
    getElementById(id: string) { return elements.find(element => element.id === id) || null; },
    querySelector(selector: string) { return elements.find(element => simpleMatch(element, selector)) || null; },
    querySelectorAll(selector: string) { return elements.filter(element => simpleMatch(element, selector)); },
    createElement(tagName: string) { return new FakeElement(tagName); },
  };
  const localStorage = {
    getItem(key: string) { return storage.get(key) ?? null; },
    setItem(key: string, value: string) { storage.set(key, value); },
    removeItem(key: string) { storage.delete(key); },
  };
  return { document, localStorage, elements, storage };
}

function issue(filePath: string, check: string, error: string): BrowserIssue {
  return { filePath, check, error };
}

async function main() {
  const root = path.resolve(process.env.SMOKE_ROOT || 'test/qwen-ecommerce-WxPTxO');
  const project = path.join(root, process.env.SMOKE_PROJECT || 'AURA');
  const files = {
    html: path.join(project, 'index.html'),
    css: path.join(project, 'style.css'),
    js: path.join(project, 'script.js'),
  };
  const report: { root: string; project: string; checks: Array<{ name: string; ok: boolean; error?: string }>; staticIssues: BrowserIssue[]; runtimeError?: string } = {
    root, project, checks: [], staticIssues: [],
  };
  const read = (file: string) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
  const html = read(files.html) || '';
  const css = read(files.css) || '';
  const js = read(files.js) || '';
  const relativeHtml = `${process.env.SMOKE_PROJECT || 'AURA'}/index.html`;
  const relativeJs = `${process.env.SMOKE_PROJECT || 'AURA'}/script.js`;
  const allFiles = [relativeHtml, `${process.env.SMOKE_PROJECT || 'AURA'}/style.css`, relativeJs];
  const byRelative = (relative: string) => read(path.join(root, relative));

  for (const [name, file] of Object.entries(files)) {
    const ok = fs.existsSync(file) && (read(file) || '').trim().length > 0;
    report.checks.push({ name: `${name}-exists`, ok, error: ok ? undefined : `Missing or empty ${file}` });
  }
  try {
    await transform(js, { loader: 'js', format: 'cjs', sourcefile: files.js });
    report.checks.push({ name: 'javascript-syntax', ok: true });
  } catch (error) {
    report.checks.push({ name: 'javascript-syntax', ok: false, error: String(error) });
  }
  report.staticIssues.push(...inspectBrowserScripts(relativeHtml, html, relative => byRelative(relative)));
  report.staticIssues.push(...checkExplicitWebRequirements(
    'Build a polished high-end animated responsive e-commerce website with search, category filter, cart, checkout, keyboard accessibility and localStorage persistence.',
    allFiles,
    relative => byRelative(relative),
  ));
  report.checks.push({ name: 'static-browser-contract', ok: report.staticIssues.length === 0, error: report.staticIssues.map(item => `${item.filePath}: ${item.error}`).join(' | ') || undefined });

  if (js.trim()) {
    const runtime = createRuntime(html);
    try {
      vm.runInNewContext(js, {
        document: runtime.document,
        localStorage: runtime.localStorage,
        console,
        setTimeout,
        clearTimeout,
        window: { document: runtime.document, localStorage: runtime.localStorage },
      }, { filename: files.js, timeout: 2_000 });
      report.checks.push({ name: 'runtime-bootstrap', ok: true });
      const search = runtime.elements.find(element => element.id === 'search-input');
      const cards = runtime.elements.filter(element => /^product-[1-6]$/.test(element.id));
      if (cards.length !== 6) throw new Error(`Expected six product cards, found ${cards.length}.`);
      if (!search) throw new Error('Search control was not available to the runtime.');
      search.value = 'Sol';
      search.dispatchEvent({ type: 'input' });
      const searchVisible = cards.filter(card => card.style.display !== 'none').length;
      if (searchVisible !== 1) throw new Error(`Search interaction did not narrow the product grid (visible=${searchVisible}, displays=${cards.map(card => `${card.id}:${card.style.display}`).join(',')}).`);
      const category = runtime.elements.find(element => element.id === 'category-select');
      if (!category) throw new Error('Category filter was not available to the runtime.');
      search.value = '';
      search.dispatchEvent({ type: 'input' });
      category.value = 'home';
      category.dispatchEvent({ type: 'change' });
      if (cards.filter(card => card.style.display !== 'none').length !== 2) throw new Error('Category interaction did not filter the product grid.');
      category.value = 'all';
      category.dispatchEvent({ type: 'change' });
      const add = runtime.elements.find(element => element.className.split(/\s+/).includes('add-to-cart-btn'));
      if (!add) throw new Error('Add-to-cart control was not available to the runtime.');
      add.click();
      const storedAfterAdd = JSON.parse(runtime.storage.get('aura-cart') || '[]');
      if (storedAfterAdd.length !== 1 || runtime.document.getElementById('cart-count')?.textContent !== '1') throw new Error('Add-to-cart did not persist or update the cart count.');
      const cartList = runtime.document.getElementById('cart-list');
      const remove = cartList?.children[0]?.children.find(child => child.className.includes('remove-from-cart-btn'));
      if (!remove) throw new Error('Rendered cart item did not expose a remove control.');
      remove.click();
      if (JSON.parse(runtime.storage.get('aura-cart') || '[]').length !== 0) throw new Error('Remove-from-cart did not persist the empty cart.');
      runtime.document.getElementById('checkout-button')?.click();
      report.checks.push({ name: 'runtime-interactions', ok: true });
    } catch (error) {
      report.runtimeError = String(error instanceof Error ? error.message : error);
      report.checks.push({ name: 'runtime-bootstrap', ok: false, error: report.runtimeError });
      report.checks.push({ name: 'runtime-interactions', ok: false, error: 'Skipped because bootstrap threw an exception.' });
    }
  }
  const allOk = report.checks.every(check => check.ok);
  const output = { ...report, allOk, note: 'This is a deterministic static/fake-DOM smoke. It is not a substitute for a real headless-browser interaction test.' };
  fs.writeFileSync(path.join(root, 'behavior-report.json'), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
  if (!allOk) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
