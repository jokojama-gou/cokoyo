// Run against a mock-backend Vite server: node tools/check-responsive.mjs [URL]
// Screenshots go to the ignored artifacts/responsive directory at the repo root.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const base = process.argv[2] ?? 'http://127.0.0.1:5174/';
const output = new URL('../../artifacts/responsive/', import.meta.url);
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 10_000 });

const appUrl = (params = {}) => {
  const url = new URL(base);
  url.searchParams.set('shell', 'app');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.href;
};

async function launchBrowser() {
  const attempts = [];
  for (const channel of new Set([process.env.PLAYWRIGHT_CHANNEL, undefined, 'chrome', 'msedge'])) {
    if (channel === '') continue;
    try {
      return await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
    } catch (error) {
      attempts.push(`${channel ?? 'bundled Chromium'}: ${error.message.split('\n')[0]}`);
    }
  }
  throw new Error(`No usable Chromium browser.\n${attempts.join('\n')}`);
}

const browser = await launchBrowser();
const pageErrors = [];
const screenshot = async (page, name) => {
  await page.screenshot({
    path: fileURLToPath(new URL(`${name}.png`, output)),
    animations: 'disabled',
  });
};

// Check the page and the visible scroll areas, including ones clipped by body
// overflow:hidden. A clipped wide card is still a failure for its user.
async function noHorizontalOverflow(page, label) {
  const result = await page.evaluate(() => {
    const width = window.innerWidth;
    const root = document.documentElement;
    const areas = [...document.querySelectorAll('nav, .content, .map-body, [role="dialog"]')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width && rect.height && element.getAttribute('aria-hidden') !== 'true';
      })
      .map((element) => ({
        element: element.getAttribute('aria-label') ?? element.className,
        client: element.clientWidth,
        scroll: element.scrollWidth,
      }))
      .filter((area) => area.scroll > area.client + 2);
    return { width, rootWidth: root.scrollWidth, areas };
  });
  assert.ok(result.rootWidth <= result.width + 2, `${label}: page exceeds viewport: ${JSON.stringify(result)}`);
  assert.deepEqual(result.areas, [], `${label}: scroll area has horizontal overflow`);
}

async function reachable(locator, label) {
  await expect(locator, label).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  // Browser intersection geometry can round a fully scrolled button by a
  // fractional pixel; its complete hit target still has to be actionable.
  await expect(locator, label).toBeInViewport({ ratio: 0.99 });
  await locator.click({ trial: true });
}

async function bounded(locator, page, label) {
  await expect(locator, label).toBeVisible();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(box && viewport, `${label}: missing visible box`);
  assert.ok(box.x >= -1 && box.x + box.width <= viewport.width + 1,
    `${label}: horizontal bounds ${JSON.stringify(box)}`);
  assert.ok(box.y >= -1 && box.y + box.height <= viewport.height + 1,
    `${label}: vertical bounds ${JSON.stringify(box)}`);
}

const allSizes = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 844, height: 390 },
  { width: 740, height: 375 },
  { width: 667, height: 375 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
];
// Optional targeted rerun after a failure or a new viewport requirement:
// RESPONSIVE_VIEWPORTS=667x375 node tools/check-responsive.mjs
const selected = process.env.RESPONSIVE_VIEWPORTS?.split(',');
const sizes = selected
  ? allSizes.filter(({ width, height }) => selected.includes(`${width}x${height}`))
  : allSizes;
assert.ok(sizes.length, 'No configured viewport matches RESPONSIVE_VIEWPORTS');

try {
  for (const viewport of sizes) {
    const name = `${viewport.width}x${viewport.height}`;
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      serviceWorkers: 'block',
      reducedMotion: 'reduce',
      timezoneId: 'Asia/Tokyo',
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(`${name}: ${error.message}`));
    page.setDefaultTimeout(10_000);
    const nav = page.getByRole('navigation', { name: '画面の切り替え' });
    const tab = (label) => nav.getByRole('button', { name: new RegExp(label) });
    try {
      await page.goto(appUrl());
      const check = page.getByRole('button', { name: /ポイント獲得/ });
      await reachable(check, `${name}: presence check is reachable`);
      await bounded(nav, page, `${name}: navigation`);
      await noHorizontalOverflow(page, `${name}: home`);
      await screenshot(page, `${name}-home`);

      // The ordinary check action must finish and populate the live map.
      await check.click();
      await expect(page.getByText('キャンパス外です', { exact: false }).first()).toBeVisible();
      await expect(check).toBeEnabled();
      await page.getByRole('button', { name: 'キャンパスの地図をひらく' }).click();
      const map = page.getByRole('img', { name: /^キャンパスの地図/ });
      await expect(map).toBeVisible();
      const back = page.getByRole('button', { name: 'ホームにもどる' });
      await reachable(back, `${name}: map close`);
      await noHorizontalOverflow(page, `${name}: map`);
      // Pick a populated building through the accessible pin and confirm its
      // occupants appear; this exercises the map's overlay hit targets.
      const pin = page.getByRole('button', { name: /に\d+人$/ }).first();
      await pin.click();
      await expect(page.getByText(/人がここに$/)).toBeVisible();
      await screenshot(page, `${name}-map`);
      await back.click();

      // Resize the same loaded app, including orientation changes. The result
      // of the user's completed check must survive and both controls must stay
      // usable, with no page reload or replacement of the browser context.
      if (viewport === sizes[0]) {
        for (const rotated of [
          { width: 390, height: 844 },
          { width: 844, height: 390 },
          { width: 1440, height: 900 },
        ]) {
          const size = `${rotated.width}x${rotated.height}`;
          await page.setViewportSize(rotated);
          await expect(page.getByText('キャンパス外です', { exact: false }).first()).toBeVisible();
          await reachable(check, `${size}: check after resize`);
          await bounded(nav, page, `${size}: navigation after resize`);
          await noHorizontalOverflow(page, `${size}: resize`);
          await screenshot(page, `${name}-resized-${size}`);
        }
        await page.setViewportSize(viewport);
        console.log(`PASS ${name}: same-page portrait, landscape and desktop resize preserves check result`);
      }

      await tab('フレンド').click();
      const addFriend = page.getByRole('button', { name: 'フレンドを追加', exact: true });
      await reachable(addFriend, `${name}: add friend`);
      await noHorizontalOverflow(page, `${name}: friends`);
      await screenshot(page, `${name}-friends`);
      await addFriend.click();
      const dialog = page.getByRole('dialog', { name: 'フレンドを追加' });
      await bounded(dialog, page, `${name}: friend dialog`);
      await expect(dialog.getByRole('tab', { name: 'QR', exact: true })).toBeVisible();
      await dialog.getByRole('tab', { name: 'リンクで共有' }).click();
      const copyLink = dialog.getByRole('button', { name: '招待リンクをコピー', exact: true });
      await reachable(copyLink, `${name}: share link control`);
      await noHorizontalOverflow(page, `${name}: friend dialog`);
      await screenshot(page, `${name}-add-friend`);
      const close = dialog.getByRole('button', { name: '閉じる', exact: true });
      await reachable(close, `${name}: friend dialog close`);
      await close.click();
      await expect(dialog).toBeHidden();

      await tab('設定').click();
      await expect(page.getByRole('heading', { name: 'プロフィール', exact: true })).toBeVisible();
      await noHorizontalOverflow(page, `${name}: settings`);
      await screenshot(page, `${name}-settings`);
      // A fixed-size photo crop needs real room inside the profile card.
      // Upload a local in-memory fixture, then exercise its visible controls.
      await page.getByLabel('アイコンにする写真', { exact: true }).setInputFiles({
        name: 'avatar-test.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#EA580C"/><circle cx="128" cy="128" r="80" fill="#fff"/></svg>'),
      });
      const crop = page.getByRole('group', { name: 'アイコンの位置を決める', exact: true });
      const photo = crop.getByRole('img', { name: '選んだ写真', exact: true });
      await photo.scrollIntoViewIfNeeded();
      await bounded(photo, page, `${name}: photo crop`);
      await expect(photo).toBeInViewport({ ratio: 0.99 });
      await noHorizontalOverflow(page, `${name}: photo crop`);
      await screenshot(page, `${name}-settings-photo-crop`);
      const zoom = crop.getByRole('slider', { name: '写真の大きさ', exact: true });
      await zoom.focus();
      await zoom.press('ArrowRight');
      await expect(zoom).toHaveValue('1.01');
      const savePhoto = crop.getByRole('button', { name: 'これにする', exact: true });
      await reachable(savePhoto, `${name}: save photo crop`);
      await noHorizontalOverflow(page, `${name}: photo crop controls`);
      await savePhoto.click();
      await expect(crop).toBeHidden();
      // Reaching the last section and then a preceding logout button checks
      // that the entire settings page scrolls in both directions.
      await page.getByRole('heading', { name: 'このアプリについて' }).scrollIntoViewIfNeeded();
      await expect(page.getByRole('heading', { name: 'このアプリについて' })).toBeInViewport({ ratio: 0.99 });
      const logout = page.getByRole('button', { name: 'ログアウト', exact: true });
      await reachable(logout, `${name}: logout`);
      await logout.click();
      const login = page.getByRole('button', { name: 'keio.jp のGoogleでログイン', exact: true });
      await reachable(login, `${name}: login`);
      await noHorizontalOverflow(page, `${name}: login`);
      await screenshot(page, `${name}-login`);
      await login.click();
      await expect(check).toBeVisible();
      console.log(`PASS ${name}: home, check, map, friends, dialog, settings, photo crop, logout and login`);
    } catch (error) {
      await screenshot(page, `${name}-failure`).catch(() => {});
      throw error;
    } finally {
      await context.close();
    }
  }

  // The explain route remains a phone mock even on a desktop monitor. Use its
  // public demo button to create an account, then exercise actual app forms.
  for (const viewport of sizes.filter(({ width }) => [1440, 844, 320].includes(width))) {
    const name = `${viewport.width}x${viewport.height}`;
    const context = await browser.newContext({ viewport, serviceWorkers: 'block', reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(`${name} onboarding: ${error.message}`));
    try {
      const explain = new URL(base);
      explain.searchParams.set('shell', 'explain');
      await page.goto(explain.href);
      await expect(page.getByRole('heading', { name: 'デモ操作', exact: true })).toBeVisible();
      if (viewport.width >= 900) {
        const device = await page.locator('.device').boundingBox();
        assert.ok(device && device.width <= 430, `${name}: explain phone mock expanded`);
        await screenshot(page, `${name}-explain`);
      }
      await page.getByRole('button', { name: '新規登録画面から始める', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'フレンドに表示される名前' })).toBeVisible();
      await page.goto(appUrl());
      await page.getByRole('textbox', { name: '表示名', exact: true }).fill('横画面テスト');
      await reachable(page.getByRole('button', { name: '次へ', exact: true }), `${name}: onboarding next`);
      await noHorizontalOverflow(page, `${name}: onboarding name`);
      await screenshot(page, `${name}-onboarding-name`);
      await page.getByRole('button', { name: '次へ', exact: true }).click();
      await expect(page.getByRole('heading', { name: '最初の端末を登録' })).toBeVisible();
      await page.getByRole('textbox', { name: 'MACアドレス', exact: true }).fill('5e:12:34:56:78:90');
      const register = page.getByRole('button', { name: '登録する', exact: true });
      await reachable(register, `${name}: register`);
      await noHorizontalOverflow(page, `${name}: onboarding MAC`);
      await screenshot(page, `${name}-onboarding-mac`);
      await register.click();
      await expect(page.getByRole('heading', { name: '登録しました', exact: true })).toBeVisible();
      const later = page.getByRole('button', { name: 'あとで', exact: true });
      await reachable(later, `${name}: complete registration`);
      await later.click();
      await expect(page.getByRole('button', { name: /ポイント獲得/ })).toBeVisible();
      console.log(`PASS ${name}: explain phone mock and new account registration`);
    } catch (error) {
      await screenshot(page, `${name}-onboarding-failure`).catch(() => {});
      throw error;
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(pageErrors, [], 'Browser runtime errors');
  console.log(`Responsive smoke test passed. Screenshots: ${fileURLToPath(output)}`);
} finally {
  await browser.close();
}
