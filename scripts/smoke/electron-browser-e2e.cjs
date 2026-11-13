const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.disableHardwareAcceleration();

const fixtureRoot = path.resolve('test/qwen-ecommerce-WxPTxO/AURA');
const artifactRoot = path.resolve('.qa-dist/electron-browser');
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function captureArtifact(window, file) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const image = (await window.webContents.capturePage()).toPNG();
      fs.writeFileSync(file, image);
      return { name: path.basename(file), bytes: image.length };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await wait(150 * (attempt + 1));
    }
  }
  if (/UnknownVizError|capturePage|native image/i.test(String(lastError?.message || lastError))) {
    return { name: path.basename(file), bytes: 0, warning: String(lastError?.message || lastError) };
  }
  throw lastError;
}

function startFixtureServer() {
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent((request.url || '/').split('?')[0]);
    const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    const file = path.resolve(fixtureRoot, relative);
    const relativeToRoot = path.relative(fixtureRoot, file);
    if (!relativeToRoot || relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    try {
      const body = fs.readFileSync(file);
      response.writeHead(200, {
        'Content-Type': mimeTypes[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'none';",
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function waitForLoad(window) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!window.webContents.isLoading()) {
      await wait(100);
      return;
    }
    await wait(100);
  }
  throw new Error('Electron browser fixture did not finish loading within 3 seconds.');
}

async function main() {
  if (!fs.existsSync(path.join(fixtureRoot, 'index.html'))) throw new Error(`Fixture missing: ${fixtureRoot}`);
  fs.mkdirSync(artifactRoot, { recursive: true });
  const server = await startFixtureServer();
  let window;
  try {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    if (!port) throw new Error('Fixture server did not expose a port.');
    window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { contextIsolation: true, sandbox: true } });
    const consoleErrors = [];
    const failedLoads = [];
    window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (level >= 2) consoleErrors.push({ level, message, line, sourceId });
    });
    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      failedLoads.push({ errorCode, errorDescription, validatedURL });
    });
    await window.loadURL(`http://127.0.0.1:${port}/`);
    await waitForLoad(window);

    const initial = await window.webContents.executeJavaScript(`(() => ({
      ready: document.readyState,
      title: document.title,
      stylesheetCount: document.styleSheets.length,
      products: document.querySelectorAll('.product-card').length,
      hasRequiredControls: Boolean(document.querySelector('#search-input') && document.querySelector('#category-select') && document.querySelector('#cart-list') && document.querySelector('#subtotal')),
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      heroHeight: Math.round(document.querySelector('.hero')?.getBoundingClientRect().height || 0),
      linkedAssets: [...document.querySelectorAll('link[rel="stylesheet"], script[src]')].map(node => node.getAttribute('href') || node.getAttribute('src')),
      focusVisibleRule: [...document.styleSheets].some(sheet => { try { return [...sheet.cssRules].some(rule => /focus-visible/.test(rule.cssText)); } catch { return false; } }),
    }))()`, true);
    if (initial.ready !== 'complete' || initial.title !== 'AURA MARKET — Curated objects' || initial.stylesheetCount < 1 || initial.products !== 6 || !initial.hasRequiredControls || initial.heroHeight < 200 || initial.linkedAssets.some(asset => !asset) || !initial.focusVisibleRule || consoleErrors.length || failedLoads.length) {
      throw new Error(`Initial browser contract failed: ${JSON.stringify({ initial, consoleErrors, failedLoads })}`);
    }

    const interactions = await window.webContents.executeJavaScript(`(() => {
      localStorage.clear();
      const search = document.querySelector('#search-input');
      const category = document.querySelector('#category-select');
      search.value = 'vase';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      const searchVisible = [...document.querySelectorAll('.product-card')].filter(card => getComputedStyle(card).display !== 'none').length;
      search.value = '';
      category.value = 'wear';
      category.dispatchEvent(new Event('change', { bubbles: true }));
      const categoryVisible = [...document.querySelectorAll('.product-card')].filter(card => getComputedStyle(card).display !== 'none').length;
      category.value = 'all';
      category.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('.add-to-cart-btn[data-product-id="1"]').click();
      const checkoutButton = document.querySelector('#checkout-button');
      checkoutButton.click();
      const checkoutFeedback = document.querySelector('#checkout-feedback').textContent;
      const removeButton = document.querySelector('.remove-from-cart-btn');
      const hasRemoveControl = Boolean(removeButton);
      removeButton?.click();
      const removedCartCount = document.querySelector('#cart-count').textContent;
      document.querySelector('.add-to-cart-btn[data-product-id="1"]').click();
      return {
        searchVisible,
        categoryVisible,
        cartCount: document.querySelector('#cart-count').textContent,
        subtotal: document.querySelector('#subtotal').textContent,
        feedback: document.querySelector('#checkout-feedback').textContent,
        checkoutFeedback,
        hasRemoveControl,
        removedCartCount,
        storedCart: localStorage.getItem('aura-cart'),
      };
    })()`, true);
    if (interactions.searchVisible !== 1 || interactions.categoryVisible !== 2 || interactions.cartCount !== '1' || interactions.subtotal !== '$128.00' || interactions.checkoutFeedback !== 'Checkout is ready — your selection is reserved.' || !interactions.hasRemoveControl || interactions.removedCartCount !== '0' || !interactions.storedCart || consoleErrors.length || failedLoads.length) {
      throw new Error(`Interaction contract failed: ${JSON.stringify(interactions)}`);
    }

    await window.webContents.reload();
    await waitForLoad(window);
    const persistence = await window.webContents.executeJavaScript(`(() => ({
      cartCount: document.querySelector('#cart-count').textContent,
      cartRows: document.querySelectorAll('#cart-list .cart-item').length,
      subtotal: document.querySelector('#subtotal').textContent,
    }))()`, true);
    if (persistence.cartCount !== '1' || persistence.cartRows !== 1 || persistence.subtotal !== '$128.00' || consoleErrors.length || failedLoads.length) {
      throw new Error(`Persistence contract failed: ${JSON.stringify(persistence)}`);
    }

    const desktopArtifact = await captureArtifact(window, path.join(artifactRoot, 'aura-desktop.png'));
    await window.setSize(390, 844);
    await wait(150);
    const responsive = await window.webContents.executeJavaScript(`(() => ({
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      heroVisible: getComputedStyle(document.querySelector('.hero')).display !== 'none',
      reducedMotionRule: [...document.styleSheets].some(sheet => { try { return [...sheet.cssRules].some(rule => rule.cssText.includes('prefers-reduced-motion')); } catch { return false; } }),
    }))()`, true);
    if (responsive.width < 360 || responsive.width > 390 || responsive.scrollWidth > responsive.width + 1 || !responsive.heroVisible || !responsive.reducedMotionRule) {
      throw new Error(`Responsive browser contract failed: ${JSON.stringify(responsive)}`);
    }

    const mobileArtifact = await captureArtifact(window, path.join(artifactRoot, 'aura-mobile.png'));
    const artifacts = [desktopArtifact, mobileArtifact];
    const screenshotWarnings = artifacts.filter(item => item.warning).map(item => `${item.name}: ${item.warning}`);
    if (artifacts.some(item => item.bytes > 0 && item.bytes < 1024)) throw new Error(`Screenshot artifact is unexpectedly small: ${JSON.stringify(artifacts)}`);
    console.log(JSON.stringify({ pass: true, initial, interactions, persistence, responsive, consoleErrors, failedLoads, artifacts, screenshotWarnings }, null, 2));
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    await new Promise(resolve => server.close(resolve));
  }
}

app.whenReady().then(() => main().then(() => app.quit()).catch(error => { console.error(error.stack || error); app.exit(1); }));
