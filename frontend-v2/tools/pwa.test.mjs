import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from '@playwright/test';

const dist = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const workerSource = readFileSync(resolve(dist, 'sw.js'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(dist, 'manifest.webmanifest'), 'utf8'));

test('mobile manifest and generated worker contain the complete built shell', () => {
  assert.equal(manifest.id, './');
  assert.equal(manifest.start_url, './?shell=app');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.orientation, 'portrait');
  assert.ok(!workerSource.includes('__COKOYO_'));
  const files = JSON.parse(workerSource.match(/const FILES = (\[[^\n]+\]);/)[1]);
  for (const name of files) assert.ok(readFileSync(resolve(dist, name)).length, name);
  const html = readFileSync(resolve(dist, 'index.html'), 'utf8');
  for (const [, asset] of html.matchAll(/(?:src|href)="(\.\/assets\/[^"?]+)"/g)) {
    assert.ok(files.includes(asset), `precache missing ${asset}`);
  }
});

test('PWA starts offline, bypasses private routes, and applies complete updates on request', { timeout: 60000 }, async () => {
  let revision = 0;
  let failPrecache = false;
  let apiRequests = 0;
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (pathname === '/blank.html') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Cache setup</title>');
      return;
    }
    if (/^\/api(\/|$)/.test(pathname)) {
      apiRequests++;
      response.setHeader('Content-Type', 'application/json');
      response.statusCode = pathname === '/api/v1/auth/session' ? 401 : 200;
      response.end(JSON.stringify({ private: true, error: { message: 'ログインしてください' } }));
      return;
    }
    if (failPrecache && pathname === '/legal.css') {
      response.writeHead(503).end('Unavailable during update');
      return;
    }
    const name = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
    const file = resolve(dist, `.${name}`);
    if (!file.startsWith(`${dist}${sep}`)) { response.writeHead(404).end(); return; }
    try {
      let body = readFileSync(file);
      if (revision && pathname === '/sw.js') {
        body = Buffer.from(body.toString().replace(/const VERSION = '([^']+)';/, `const VERSION = '$1-${revision}';`));
      }
      if (name === '/index.html') {
        body = Buffer.from(body.toString().replace('</head>', `<meta name="test-revision" content="${revision}"></head>`));
      }
      response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.png': 'image/png', '.webmanifest': 'application/manifest+json' })[extname(file)] || 'application/octet-stream');
      response.end(body);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}/`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PWA_BROWSER_CHANNEL ? { channel: process.env.PWA_BROWSER_CHANNEL } : {}) });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
    await page.goto(`${base}blank.html`);
    await page.evaluate(async (origin) => {
      await caches.open('unrelated-app');
      await caches.open(`cokoyo-shell:${origin}elsewhere/:old`);
      await caches.open('cokoyo-shell-v1');
    }, base);
    await page.goto(base);
    await page.getByRole('button', { name: 'keio.jp のGoogleでログイン' }).waitFor();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const initialWorker = await page.evaluate(() => navigator.serviceWorker.controller.scriptURL);
    assert.equal(initialWorker, `${base}sw.js`);
    const keys = await page.evaluate(() => caches.keys());
    assert.ok(keys.includes('unrelated-app'));
    assert.ok(keys.includes(`cokoyo-shell:${base}elsewhere/:old`));
    assert.ok(!keys.includes('cokoyo-shell-v1'));
    const beforeApi = apiRequests;
    await page.evaluate(async () => {
      await fetch('/api/private-check');
      await fetch('/api/private-check');
      await fetch('/api');
      await fetch('/admin/');
    });
    assert.equal(apiRequests - beforeApi, 3, 'API requests must always reach the server');
    const cachedUrls = await page.evaluate(async () => {
      const result = [];
      for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) result.push(request.url);
      return result;
    });
    assert.ok(!cachedUrls.some((url) => /\/api(?:\/|$)|\/admin\//.test(url)));

    await context.setOffline(true);
    await page.goto(`${base}?shell=app&add=sk_offlineInvite`);
    await page.getByText('オフラインです。在校確認やログインには通信が必要です。', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'もう一度試す' }).waitFor();
    assert.equal(await page.evaluate(() => navigator.onLine), false);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('cokoyo-invite:v1')), 'sk_offlineInvite');
    assert.equal(await page.evaluate(async () => { try { await fetch('/api/private-check'); return false; } catch { return true; } }), true);
    assert.equal(await page.locator('meta[name="test-revision"]').getAttribute('content'), '0');
    await page.goto(`${base}privacy/`);
    assert.ok((await page.textContent('body')).includes('プライバシー'));
    await page.goto(base);
    await page.getByRole('button', { name: 'もう一度試す' }).waitFor();
    await context.setOffline(false);
    await page.getByRole('button', { name: 'もう一度試す' }).click();
    await page.getByRole('button', { name: 'keio.jp のGoogleでログイン' }).waitFor();

    revision = 1;
    failPrecache = true;
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      const installed = new Promise((done) => {
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker.addEventListener('statechange', () => { if (worker.state === 'redundant') done(); });
        }, { once: true });
      });
      await registration.update();
      await installed;
    });
    assert.equal(await page.evaluate(async () => !!(await navigator.serviceWorker.ready).waiting), false);
    assert.ok(!(await page.evaluate(() => caches.keys())).some((name) => name.endsWith('-1')));
    assert.equal(await page.locator('meta[name="test-revision"]').getAttribute('content'), '0');

    failPrecache = false;
    const secondPage = await context.newPage();
    await secondPage.goto(base);
    await secondPage.getByRole('button', { name: 'keio.jp のGoogleでログイン' }).waitFor();
    revision = 2;
    await page.evaluate(async () => (await navigator.serviceWorker.ready).update());
    await page.getByRole('button', { name: '更新する' }).waitFor();
    assert.equal(await page.locator('meta[name="test-revision"]').getAttribute('content'), '0', 'update must wait for user action');
    await page.getByRole('button', { name: '更新する' }).click();
    await page.waitForFunction(() => document.querySelector('meta[name="test-revision"]')?.content === '2');
    await secondPage.waitForFunction(() => document.querySelector('meta[name="test-revision"]')?.content === '2');
    const finalKeys = await page.evaluate(() => caches.keys());
    assert.equal(finalKeys.filter((name) => name.startsWith(`cokoyo-shell:${base}:`)).length, 1);
    assert.ok(finalKeys.includes('unrelated-app'));
    assert.ok(finalKeys.includes(`cokoyo-shell:${base}elsewhere/:old`));
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
  }
});
