import { describe, expect, it } from 'vitest';
import { checkExplicitWebRequirements, inspectBrowserAssets, inspectBrowserScripts, repairBrowserDomReadyContract, repairBrowserMarkupContract, repairBrowserStyleContract, repairEcommerceRuntimeContract, repairMissingBrowserAssets, repairMissingBrowserCoreReferences, repairMissingDomContracts, repairThemeToggleContract } from '../browserChecks.js';
import { isPlainWebsiteRequest, requiredProjectFiles } from '../projectContract.js';

describe('one-prompt website workflow contract', () => {
  it('captures the real local-model failure: HTML wrappers and mismatched DOM ids', () => {
    const issues = inspectBrowserScripts('index.html', '<button id="updateButton">Update</button><script src="script.js"></script>', () => '<script>document.getElementById("myButton").onclick = () => {};</script>');
    expect(issues.some(i => i.check === 'browser-script')).toBe(true);
    expect(issues.some(i => i.check === 'browser-dom')).toBe(true);
    expect(inspectBrowserScripts('index.html', '<button id="updateButton">Update</button><script src="script.js"></script>', () => 'document.getElementById("updateButton").onclick = () => {};')).toEqual([]);
  });
  it('rejects an HTML document pasted into an external JavaScript file', () => {
    const issues = inspectBrowserScripts('index.html', '<script src="script.js"></script>', () => '<!doctype html><html><body><h1>wrong file</h1></body></html>');
    expect(issues.some(issue => issue.check === 'browser-script' && /HTML document/i.test(issue.error))).toBe(true);
  });
  it('detects and repairs DOM access from a synchronous head-loaded script', () => {
    const html = '<!doctype html><html><head><script src="script.js"></script></head><body><button id="theme-toggle">Theme</button></body></html>';
    const script = 'document.querySelector("#theme-toggle").addEventListener("click", () => document.body.classList.toggle("dark"));';
    const issues = inspectBrowserScripts('index.html', html, () => script);
    expect(issues.some(issue => issue.check === 'browser-dom-ready')).toBe(true);
    const repaired = repairBrowserDomReadyContract(script);
    expect(repaired.changed).toBe(true);
    expect(repaired.content).toContain('DOMContentLoaded');
    expect(repairBrowserDomReadyContract(repaired.content).changed).toBe(false);
  });
  it('checks root DOM contracts even when a renderer creates dynamic cart rows', () => {
    const issues = inspectBrowserScripts(
      'AURA/index.html',
      '<input id="search-input"><script src="script.js"></script>',
      () => `const cart = document.createElement('ul'); document.getElementById('search-input').addEventListener('input', () => {}); document.getElementById('cart-list').innerHTML = ''; document.querySelectorAll('.add-to-cart-btn');`,
    );
    expect(issues.filter(issue => issue.check === 'browser-dom').map(issue => issue.error).join('\n')).toContain('cart-list');
    expect(issues.some(issue => issue.error.includes('.add-to-cart-btn'))).toBe(true);
  });
  it('derives the complete static-site manifest plus requested optional deliverables', () => {
    expect(requiredProjectFiles('Build a dashboard website with a logo and config')).toEqual([
      'index.html', 'style.css', 'script.js', 'assets/placeholder.svg', 'config.json',
    ]);
    expect(requiredProjectFiles('Build a website with assets/logo.svg and config.json')).toEqual([
      'index.html', 'style.css', 'script.js', 'assets/logo.svg', 'config.json',
    ]);
  });

  it('recognizes e-commerce HTML/CSS/JS repair prompts as plain websites', () => {
    expect(isPlainWebsiteRequest('Repair the existing e-commerce UI using HTML/CSS/JS')).toBe(true);
    expect(isPlainWebsiteRequest('Fix the Python ecommerce API service')).toBe(false);
  });

  it('rejects a heading-only page and missing local browser references', () => {
    const files: Record<string, string> = {
      'index.html': '<!doctype html><html><body><h1>Hello</h1></body></html>',
    };
    const read = (file: string) => files[file];
    const quality = checkExplicitWebRequirements('Build a website', ['index.html'], read);
    expect(quality.some(issue => issue.check === 'html-quality')).toBe(true);

    const references = inspectBrowserAssets(
      'index.html',
      '<link rel="stylesheet" href="style.css"><img src="assets/logo.svg">',
      read,
    );
    expect(references).toHaveLength(2);
    expect(references.every(issue => issue.check === 'browser-asset')).toBe(true);
  });
  it('rejects explicit placeholder comments and empty product cards', () => {
    const files: Record<string, string> = {
      'index.html': '<!doctype html><html><body><main><h1>Store</h1><section class="products"><div class="product"><!-- Product card content here --></div></section></main><link rel="stylesheet" href="style.css"><script src="script.js"></script></body></html>',
      'style.css': 'main { color: #123; }',
      'script.js': 'document.querySelector("main");',
    };
    expect(checkExplicitWebRequirements('Build an e-commerce website', Object.keys(files), file => files[file]).some(issue => issue.check === 'html-quality')).toBe(true);
  });

  it('repairs only verifier-backed placeholder and cart-selector markup', () => {
    const source = '<body><!-- Product card content here --><main><h1>Store</h1></main></body>';
    const repaired = repairBrowserMarkupContract(source, { removePlaceholders: true, ensureRemoveFromCart: true });
    expect(repaired.changed).toBe(true);
    expect(repaired.content).not.toMatch(/content here/i);
    expect(repaired.content).toContain('class="remove-from-cart"');
    expect(repairBrowserMarkupContract(repaired.content, { removePlaceholders: true, ensureRemoveFromCart: true }).changed).toBe(false);
  });

  it('repairs an explicit AURA cross-file DOM contract mismatch deterministically', () => {
    const html = '<!doctype html><html><body><h1>AURA MARKET</h1><section id="product-1"></section><input id="search-input"><script src="script.js"></script></body></html>';
    const script = 'const list = document.getElementById("product-list"); document.getElementById("checkout-btn"); document.querySelectorAll(".add-to-cart-btn"); document.querySelectorAll(".remove-from-cart-btn"); document.querySelectorAll(".quantity-control"); localStorage.setItem("cart", "[]");';
    const repaired = repairEcommerceRuntimeContract(html, script);
    expect(repaired.changed).toBe(true);
    expect(repaired.html).toContain('id="product-6"');
    expect(repaired.html).toContain('id="product-list"');
    expect(repaired.html).toContain('id="checkout-btn"');
    expect(repaired.script).toContain('remove-from-cart-btn');
    expect(repaired.script).toContain('checkout-btn');
    expect(repairEcommerceRuntimeContract(repaired.html, repaired.script).changed).toBe(false);
  });

  it('repairs common missing checkout and quantity selectors without rewriting the page', () => {
    const html = '<main><button type="button">Checkout</button><input type="number" class="qty"></main>';
    const failures = [
      { error: 'JavaScript references DOM id "checkout-btn" absent from index.html.' },
      { error: 'JavaScript references CSS class ".quantity-control" absent from index.html.' },
    ];
    const repaired = repairMissingDomContracts(html, failures);
    expect(repaired.changed).toBe(true);
    expect(repaired.content).toContain('id="checkout-btn"');
    expect(repaired.content).toContain('class="qty quantity-control"');
    expect(repairMissingDomContracts(repaired.content, failures).changed).toBe(false);
  });

  it('adds deterministic contract controls when no matching source element exists', () => {
    const repaired = repairMissingDomContracts('<body><main>Products</main></body>', [
      { error: 'JavaScript references DOM id "checkout-btn" absent from index.html.' },
      { error: 'JavaScript references CSS class ".remove-from-cart-btn" absent from index.html.' },
      { error: 'JavaScript references CSS class ".quantity-control" absent from index.html.' },
    ]);
    expect(repaired.changed).toBe(true);
    expect(repaired.content).toContain('id="checkout-btn"');
    expect(repaired.content).toContain('class="remove-from-cart-btn"');
    expect(repaired.content).toContain('class="quantity-control"');
  });

  it('adds only the missing responsive, motion and focus safety contract', () => {
    const source = '<!doctype html><html><head><title>Store</title></head><body><main><h1>Store</h1></main></body></html>';
    const repaired = repairBrowserMarkupContract(source, { ensureResponsiveMotionAccessibility: true });
    expect(repaired.changed).toBe(true);
    expect(repaired.content).toContain('data-quillix-quality-contract');
    expect(repaired.content).toContain('@media (max-width: 720px)');
    expect(repaired.content).toContain('@keyframes quillix-reveal');
    expect(repaired.content).toContain(':focus-visible');
    expect(repairBrowserMarkupContract(repaired.content, { ensureResponsiveMotionAccessibility: true }).changed).toBe(false);
  });

  it('repairs a linked stylesheet without rewriting its existing design', () => {
    const source = '.hero { color: rebeccapurple; }';
    const repaired = repairBrowserStyleContract(source, { ensureResponsive: true, ensureMotion: true, ensureFocus: true });
    expect(repaired.changed).toBe(true);
    expect(repaired.content).toContain('.hero { color: rebeccapurple; }');
    expect(repaired.content).toContain(':focus-visible');
    expect(repaired.content).toContain('@media (max-width: 720px)');
    expect(repaired.content).toContain('@keyframes quillix-reveal');
    expect(repairBrowserStyleContract(repaired.content, { ensureResponsive: true, ensureMotion: true, ensureFocus: true }).changed).toBe(false);
  });

  it('repairs a missing theme-toggle behavior without replacing existing JavaScript', () => {
    const html = '<button id="theme-toggle">Theme</button>';
    const source = 'const app = document.querySelector("main");';
    const repaired = repairThemeToggleContract(html, source);
    expect(repaired.changed).toBe(true);
    expect(repaired.content).toContain('classList.toggle');
    expect(repaired.content).toContain('theme-dark');
    expect(repaired.content).toContain(source);
    expect(repairThemeToggleContract(html, repaired.content).changed).toBe(false);
  });

  it('normalizes local site-root assets for project-folder preview', () => {
    const source = '<link rel="stylesheet" href="/style.css"><script src="/script.js"></script><img src="/assets/product-1.jpg">';
    const repaired = repairBrowserMarkupContract(source, { removePlaceholders: true });
    expect(repaired.changed).toBe(true);
    expect(repaired.content).toContain('href="style.css"');
    expect(repaired.content).toContain('src="script.js"');
    expect(repaired.content).toContain('src="assets/product-1.jpg"');
    expect(repairBrowserMarkupContract(repaired.content, { removePlaceholders: true }).changed).toBe(false);
  });

  it('rejects site-root asset paths that break when a project is previewed from a subfolder', () => {
    const issues = inspectBrowserAssets('AURA/index.html', '<link rel="stylesheet" href="/style.css">', () => 'body {}');
    expect(issues[0]?.error).toContain('project-relative');
  });

  it('repairs invented src prefixes only when the canonical root CSS/JS files exist', () => {
    const html = '<link rel="stylesheet" href="src/style.css?v=2"><script src="src/script.js#app"></script>';
    const files: Record<string, string> = { 'style.css': 'body {}', 'script.js': 'document.body;' };
    const repaired = repairMissingBrowserCoreReferences('index.html', html, file => files[file]);
    expect(repaired.changed).toBe(true);
    expect(repaired.content).toContain('href="style.css?v=2"');
    expect(repaired.content).toContain('src="script.js#app"');
  });

  it('preserves valid nested browser files and does not guess when the root file is absent', () => {
    const nestedHtml = '<link rel="stylesheet" href="src/style.css"><script src="src/script.js"></script>';
    const nested = repairMissingBrowserCoreReferences('index.html', nestedHtml, file => ({
      'src/style.css': 'body {}', 'src/script.js': 'document.body;',
    } as Record<string, string>)[file]);
    expect(nested.changed).toBe(false);
    const absent = repairMissingBrowserCoreReferences('index.html', nestedHtml, () => undefined);
    expect(absent.changed).toBe(false);
  });

  it('repairs verifier-reported missing media with an auditable inline fallback', () => {
    const source = '<img src="images/product1.jpg"><img src="images/product2.jpg"><link rel="stylesheet" href="style.css">';
    const repaired = repairMissingBrowserAssets(source, ['images/product1.jpg', 'images/product2.jpg']);
    expect(repaired.replacements).toBe(2);
    expect(repaired.content).toContain('data:image/svg+xml');
    expect(repaired.content).not.toContain('images/product1.jpg');
    expect(repairMissingBrowserAssets(repaired.content, ['images/product1.jpg']).changed).toBe(false);
  });

  it('accepts a meaningful linked HTML/CSS/JS site', () => {
    const files: Record<string, string> = {
      'index.html': '<!doctype html><html><body><main><h1>Tasks</h1><button id="add">Add task</button><p>Track your work here.</p></main><link rel="stylesheet" href="style.css"><script src="script.js"></script></body></html>',
      'style.css': 'body { color: #123; } main { max-width: 40rem; }',
      'script.js': 'document.querySelector("#add").addEventListener("click", () => alert("added"));',
    };
    expect(checkExplicitWebRequirements('Build a task tracker website', Object.keys(files), file => files[file])).toEqual([]);
  });

  it('fails explicit animation, responsive, search and cart requirements when behavior is absent', () => {
    const files: Record<string, string> = {
      'index.html': '<!doctype html><html><body><main><h1>Store</h1><button type="button">Buy</button><input></main><link rel="stylesheet" href="style.css"><script src="script.js"></script></body></html>',
      'style.css': 'body { color: #123; }',
      'script.js': 'document.querySelector("button");',
    };
    const issues = checkExplicitWebRequirements('Build an animated responsive e-commerce website with search, cart and keyboard accessibility', Object.keys(files), file => files[file]);
    expect(issues.map(issue => issue.check)).toEqual(expect.arrayContaining(['responsive-behavior', 'motion-behavior', 'accessibility-behavior', 'requested-behavior']));
    expect(issues.find(issue => issue.check === 'accessibility-behavior')?.filePath).toBe('style.css');
    expect(issues.filter(issue => issue.check === 'requested-behavior').every(issue => issue.filePath === 'script.js')).toBe(true);
  });

  it('accepts explicit web quality requirements when the implementation is present', () => {
    const files: Record<string, string> = {
      'index.html': '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Store</title><link rel="stylesheet" href="style.css"></head><body><main><h1>Store</h1><input aria-label="Search"><button type="button" class="add-to-cart">Add to cart</button><script src="script.js"></script></main></body></html>',
      'style.css': ':focus-visible { outline: 2px solid blue; } @media (max-width: 700px) { main { padding: 1rem; } } @keyframes enter { from { opacity: 0; } }',
      'script.js': 'const cart = []; localStorage.setItem("cart", JSON.stringify(cart)); document.querySelector(".add-to-cart").addEventListener("click", () => cart.push("item")); document.querySelector("[aria-label=Search]").addEventListener("input", event => ["item"].filter(item => item.toLowerCase().includes(event.target.value.toLowerCase())));',
    };
    expect(checkExplicitWebRequirements('Build an animated responsive e-commerce website with search, cart and keyboard accessibility', Object.keys(files), file => files[file])).toEqual([]);
  });

  it('counts inline CSS for an explicitly single-file animated page', () => {
    const files: Record<string, string> = {
      'index.html': '<!doctype html><html><head><style>@media (max-width: 700px) { main { padding: 1rem; } } @keyframes enter { from { opacity: 0; } } :focus-visible { outline: 2px solid blue; }</style></head><body><main><h1>Store</h1><button type="button">Buy</button></main></body></html>',
    };
    expect(checkExplicitWebRequirements('Build a single-file animated responsive page with keyboard accessibility', Object.keys(files), file => files[file])).toEqual([]);
  });
});
