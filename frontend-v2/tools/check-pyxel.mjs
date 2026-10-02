// Check the real browser Pyxel runtime and the existing COKOYO API / account flows.
// Start Vite, then run: node tools/check-pyxel.mjs [URL] [--bootstrap-only]
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const url = process.argv.find((arg) => /^https?:/.test(arg)) ?? 'http://127.0.0.1:5175/?shell=app&mode=pyxel';
const bootstrapOnly = process.argv.includes('--bootstrap-only');
const output = fileURLToPath(new URL('../../artifacts/pyxel-ui/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, deviceScaleFactor: 1, hasTouch: true });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
const failedRequests = [];
const completed = [];
page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
page.on('requestfailed', (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
await page.addInitScript(() => {
  window.__pyxelReady = false;
  window.__pyxelFrame = null;
  window.__pyxelRuntimeErrors = [];
  window.addEventListener('message', (event) => {
    const iframe = document.querySelector('.pyxel-screen iframe');
    if (event.origin !== location.origin || event.source !== iframe?.contentWindow || event.data?.source !== 'cokoyo-pyxel') return;
    if (event.data.type === 'ready') window.__pyxelReady = true;
    if (event.data.type === 'frame') window.__pyxelFrame = event.data.payload;
    if (event.data.type === 'error') window.__pyxelRuntimeErrors.push(event.data.payload);
  });
});

const state = () => page.locator('.pyxel-screen iframe').evaluate((element) => {
  const bridge = element.contentWindow?.cokoyoBridge;
  return bridge ? JSON.parse(bridge.readState()) : {};
});
async function until(predicate, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out: ${description}; state=${JSON.stringify(await state())}`);
}
async function ready() {
  await page.waitForFunction(() => {
    const iframe = document.querySelector('.pyxel-screen iframe');
    return window.__pyxelReady && window.__pyxelFrame?.controls?.length && iframe?.contentWindow?.pyxelContext?.initialized;
  }, null, { timeout: 120000 });
  await page.locator('.pyxel-controls').waitFor();
  const runtimeErrors = await page.evaluate(() => window.__pyxelRuntimeErrors);
  assert.deepEqual(runtimeErrors, [], 'Pyxel startup reported an error');
}
const controls = () => page.evaluate(() => window.__pyxelFrame?.controls ?? []);
const matches = (control, action, args) => control.action === action && Object.entries(args).every(([key, value]) => control.args?.[key] === value);
async function scroll(delta) {
  const box = await page.locator('.pyxel-controls').boundingBox();
  assert.ok(box, 'Pyxel control layer has no viewport');
  await page.mouse.move(box.x + box.width * .65, box.y + box.height * .55);
  await page.mouse.wheel(0, delta);
  await page.waitForTimeout(150);
}
async function action(actionName, args = {}, direction = 1) {
  let control;
  for (let attempt = 0; attempt < 20; attempt++) {
    control = (await controls()).find((item) => matches(item, actionName, args) && !item.disabled);
    if (control) break;
    await scroll(direction * 280);
  }
  assert.ok(control, `No visible enabled control for ${actionName} ${JSON.stringify(args)}`);
  await page.locator('.pyxel-controls').getByRole('button', { name: control.label, exact: true }).first().click();
  await page.waitForTimeout(180);
}
async function tab(tabName) {
  await action('tab', { tab: tabName });
  await until(async () => (await state()).tab === tabName, `tab ${tabName}`);
}
async function screenshot(name) {
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: false });
}
async function step(name, fn) {
  await fn();
  completed.push(name);
  console.log(`PASS ${name}`);
}

// Chromium screenshots use 8-bit RGB / RGBA PNGs. Decode scanline filters so the
// check verifies the displayed WebGL raster, which cannot be read as a 2D canvas.
function rasterColors(png) {
  let width, height, channels;
  const data = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const kind = png.toString('ascii', offset + 4, offset + 8);
    const chunk = png.subarray(offset + 8, offset + 8 + length);
    if (kind === 'IHDR') {
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4);
      assert.equal(chunk[8], 8);
      channels = chunk[9] === 6 ? 4 : chunk[9] === 2 ? 3 : 0;
      assert.ok(channels, 'Unsupported screenshot PNG color format');
    }
    if (kind === 'IDAT') data.push(chunk);
    offset += length + 12;
  }
  const decoded = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const colors = new Set();
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = decoded[y * (stride + 1)];
    const row = Buffer.from(decoded.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = previous[x];
      const diagonal = x >= channels ? previous[x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      if (filter === 2) predictor = up;
      if (filter === 3) predictor = Math.floor((left + up) / 2);
      if (filter === 4) {
        const candidate = left + up - diagonal;
        const distances = [Math.abs(candidate - left), Math.abs(candidate - up), Math.abs(candidate - diagonal)];
        predictor = distances[0] <= distances[1] && distances[0] <= distances[2] ? left : distances[1] <= distances[2] ? up : diagonal;
      }
      row[x] = (row[x] + predictor) & 255;
    }
    if (y % 2 === 0) for (let x = 0; x < stride; x += channels * 2) colors.add(`${row[x]},${row[x + 1]},${row[x + 2]}`);
    previous = row;
  }
  return colors.size;
}

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await step('Real Pyxel / Japanese font bootstrap', async () => {
    await ready();
    const runtime = await page.locator('.pyxel-screen iframe').evaluate((element) => {
      const win = element.contentWindow;
      const canvas = win.document.getElementById('canvas');
      return {
        canvasWidth: canvas.width, canvasHeight: canvas.height,
        pyxelDimensions: win.pyxelContext.pyodide.runPython('import pyxel; str(pyxel.width) + "x" + str(pyxel.height)'),
        fontExists: win.pyxelContext.pyodide.FS.analyzePath('/pyxel_working_directory/fonts/umplus_j10r.bdf').exists,
        gameControls: win.document.querySelectorAll('[id^="pyxel-gamepad-"], #pyxel-prompt').length,
      };
    });
    runtime.colors = rasterColors(await page.frameLocator('.pyxel-screen iframe').locator('#canvas').screenshot());
    assert.ok(runtime.canvasWidth >= 320 && runtime.canvasHeight >= 240);
    assert.ok(runtime.colors >= 8, `Canvas has only ${runtime.colors} colors`);
    assert.equal(runtime.fontExists, true, 'Japanese BDF was not loaded into Pyodide');
    assert.equal(runtime.gameControls, 0, 'Game controls appeared in the application UI');
    assert.match((await controls()).map((item) => item.label).join(' '), /[一-龯ぁ-んァ-ン]/);
    console.log(JSON.stringify(runtime));
    await screenshot('desktop-home');
  });

  if (!bootstrapOnly) {
    await step('Home check, privacy toggle, campus map', async () => {
      await action('check');
      await until(async () => Boolean((await state()).lastCheck?.checkedAt), 'check response');
      const hiddenBefore = (await state()).me.hidden;
      await action('toggle-hide');
      await until(async () => (await state()).me.hidden !== hiddenBefore, 'privacy toggle');
      await action('map.open');
      await until(async () => (await state()).mapOpen === true, 'campus map open');
      await screenshot('desktop-map');
      await action('map.close');
      await until(async () => (await state()).mapOpen === false, 'campus map close');
    });
    await step('Friend list, best request, sharing overlay', async () => {
      await tab('friends');
      await action('friend.expand', { userId: 'u_tanaka' });
      await until(async () => (await state()).expandedFriend === 'u_tanaka', 'friend expansion');
      await action('friend.best.request', { userId: 'u_tanaka' });
      await until(async () => (await state()).friends.friends.find((friend) => friend.userId === 'u_tanaka')?.best === 'best', 'best friend acceptance');
      await screenshot('desktop-friends');
      await action('friends.add', {}, -1);
      await page.locator('.sheet.open').waitFor();
      await page.locator('.sheet').getByRole('tab', { name: 'リンクで共有', exact: true }).click();
      await screenshot('desktop-sharing');
      await page.getByRole('button', { name: '閉じる', exact: true }).click();
      await until(async () => !(await state()).overlay, 'sharing overlay dismissed');
    });
    await step('Japanese name entry and extra registered device', async () => {
      await tab('settings');
      await action('profile.name');
      const nameDialog = page.getByRole('dialog', { name: '表示名を変更' });
      await nameDialog.getByLabel('表示名', { exact: true }).fill('横画面テスト');
      await nameDialog.getByRole('button', { name: 'やめる', exact: true }).focus();
      await page.keyboard.press('Tab');
      assert.equal(await nameDialog.getByRole('button', { name: '閉じる', exact: true }).evaluate((element) => document.activeElement === element), true, 'Modal Tab focus escaped');
      await nameDialog.getByRole('button', { name: '保存', exact: true }).click();
      await until(async () => (await state()).me.displayName === '横画面テスト', 'Japanese name saved');
      await until(async () => (await page.evaluate(() => document.activeElement?.getAttribute('data-action'))) === 'profile.name', 'focus restored to Pyxel name control');
      await action('device.add');
      const deviceDialog = page.getByRole('dialog', { name: '端末を追加' });
      await deviceDialog.getByLabel('端末の名前', { exact: true }).fill('テストPC');
      await deviceDialog.getByLabel('MACアドレス', { exact: true }).fill('12:34:56:78:90:ab');
      await deviceDialog.getByRole('button', { name: '保存', exact: true }).click();
      await until(async () => (await state()).me.macs.some((device) => device.label === 'テストPC'), 'additional device saved');
      const discoverableBefore = (await state()).me.discoverable;
      await action('discoverability');
      await until(async () => (await state()).me.discoverable !== discoverableBefore, 'discoverability changed');
      await screenshot('desktop-settings');
    });
    await step('Logout and normal login use the existing account', async () => {
      await action('logout', { all: false });
      await until(async () => (await state()).view === 'login', 'logout screen');
      await screenshot('desktop-login');
      await action('login');
      await page.waitForLoadState('domcontentloaded');
      await ready();
      await until(async () => (await state()).view === 'app', 'logged in account');
      assert.equal((await state()).me.displayName, '横画面テスト');
    });
    await step('Mobile viewport, wheel scrolling, state preservation', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await until(async () => {
        const frame = await page.evaluate(() => window.__pyxelFrame);
        return frame?.width === 240 && frame?.height === 519;
      }, 'mobile Pyxel dimensions', 120000);
      await ready();
      assert.equal((await state()).me.displayName, '横画面テスト');
      await screenshot('mobile-home');
      await tab('settings');
      const before = await controls();
      await scroll(600);
      const after = await controls();
      assert.notEqual(JSON.stringify(before), JSON.stringify(after), 'Wheel scrolling did not move the UI');
      await screenshot('mobile-settings-scrolled');
      await scroll(-5000);
      const beforeTouch = await controls();
      const box = await page.locator('.pyxel-controls').boundingBox();
      const cdp = await context.newCDPSession(page);
      const point = { x: Math.round(box.x + box.width * .7), y: Math.round(box.y + box.height * .6) };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, y: point.y - 150 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(200);
      await cdp.detach();
      assert.notEqual(JSON.stringify(beforeTouch), JSON.stringify(await controls()), 'Touch gesture did not scroll the UI');
      await action('profile.name', {}, -1);
      await screenshot('mobile-native-name');
      await page.getByRole('dialog').getByRole('button', { name: '閉じる', exact: true }).click();
      await until(async () => (await page.evaluate(() => document.activeElement?.getAttribute('data-action'))) === 'profile.name', 'mobile modal focus restoration');
    });
    await step('Landscape mobile layout preserves the account', async () => {
      await page.setViewportSize({ width: 844, height: 390 });
      await until(async () => {
        const frame = await page.evaluate(() => window.__pyxelFrame);
        return frame?.width === 422 && frame?.height === 195;
      }, 'landscape Pyxel dimensions', 120000);
      await ready();
      assert.equal((await state()).me.displayName, '横画面テスト');
      await tab('home');
      await screenshot('landscape-home');
      await page.setViewportSize({ width: 390, height: 844 });
      await until(async () => {
        const frame = await page.evaluate(() => window.__pyxelFrame);
        return frame?.width === 240 && frame?.height === 519;
      }, 'portrait restored', 120000);
      await ready();
    });
    await step('New account onboarding retains the native IME forms', async () => {
      // Fixture only: begin an unregistered mock session; every registration action is performed through UI.
      await page.evaluate(async () => (await import('/src/api/mockBackend.ts')).mockBackend.sim.startNewAccount());
      await page.reload({ waitUntil: 'domcontentloaded' });
      await ready();
      await until(async () => (await state()).view === 'onboarding', 'unregistered account view');
      await action('onboarding');
      const dialog = page.getByRole('dialog', { name: 'はじめての登録' });
      const installNext = dialog.getByRole('button', { name: /次へ|あとで/ });
      if (!(await dialog.getByLabel('表示名', { exact: true }).isVisible())) await installNext.first().click();
      await dialog.getByLabel('表示名', { exact: true }).fill('新規テスト');
      await dialog.getByRole('button', { name: '次へ', exact: true }).click();
      await dialog.getByLabel('端末の名前', { exact: true }).fill('テスト端末');
      await dialog.getByLabel('MACアドレス', { exact: true }).fill('22:33:44:55:66:77');
      await dialog.getByRole('button', { name: '登録する', exact: true }).click();
      await dialog.getByRole('button', { name: 'あとで', exact: true }).click();
      await until(async () => (await state()).view === 'app', 'registration completed');
      assert.equal((await state()).me.displayName, '新規テスト');
      await screenshot('mobile-new-account');
    });
  }
  assert.deepEqual(errors, [], 'Browser emitted JavaScript / Python errors');
  assert.deepEqual(await page.evaluate(() => window.__pyxelRuntimeErrors), [], 'Pyxel runtime emitted errors');
} catch (error) {
  await screenshot('failure').catch(() => {});
  console.error(error);
  console.error('Runtime / host:', await page.evaluate(() => {
    const iframe = document.querySelector('.pyxel-screen iframe');
    const win = iframe?.contentWindow;
    const bounds = (element) => {
      const rect = element?.getBoundingClientRect();
      return rect ? { width: rect.width, height: rect.height, x: rect.x, y: rect.y } : null;
    };
    return {
      root: bounds(document.getElementById('root')),
      screen: bounds(document.querySelector('.pyxel-screen')),
      iframe: bounds(iframe), canvas: bounds(win?.document.getElementById('canvas')),
      fontExists: win?.pyxelContext?.pyodide?.FS.analyzePath('/pyxel_working_directory/fonts/umplus_j10r.bdf').exists,
      runtimeErrors: window.__pyxelRuntimeErrors,
      frame: window.__pyxelFrame,
    };
  }).catch(() => null));
  console.error('Browser errors:', errors);
  console.error('Failed requests:', failedRequests.slice(-12));
  process.exitCode = 1;
} finally {
  await writeFile(`${output}/${bootstrapOnly ? 'bootstrap-results' : 'results'}.json`, JSON.stringify({ url, completed, errors, failedRequests }, null, 2));
  await browser.close();
}
