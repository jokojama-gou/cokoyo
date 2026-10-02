// tools/pwa.ts がビルドごとの版とファイル一覧を埋め込む。
const VERSION = '__COKOYO_VERSION__';
const FILES = __COKOYO_PRECACHE__;
const SCOPE = self.registration.scope;
const PREFIX = `cokoyo-shell:${SCOPE}:`;
const CACHE = `${PREFIX}${VERSION}`;
const urls = new Set(FILES.map((file) => new URL(file, SCOPE).href));
const indexUrl = new URL('./index.html', SCOPE).href;

self.addEventListener('install', (event) => {
  // 全ファイルが揃うまで新しい版を有効にしない。失敗したら前の版を残す。
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      await cache.addAll([...urls].map((url) => new Request(url, { cache: 'reload' })));
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      // 旧版のキャッシュだけを消す。他のアプリや配信パスには触れない。
      if ((key.startsWith(PREFIX) && key !== CACHE) || key === 'cokoyo-shell-v1') await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// 開いている画面はその版のまま。利用者が「更新する」を押したら切り替える。
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return;

  const relative = url.pathname.slice(new URL(SCOPE).pathname.length);
  // API・OAuth・管理画面・説明用ページはオンライン通信のままにする。
  if (/^(api|admin|explain|test|documents)(\/|$)/.test(relative)) return;

  let cachedUrl = url.href;
  if (request.mode === 'navigate') {
    if (relative === '' || relative === 'index.html') cachedUrl = indexUrl;
    else if (/^(about|terms|privacy)\/$/.test(relative)) cachedUrl = new URL(`${relative}index.html`, SCOPE).href;
  }
  if (!urls.has(cachedUrl)) return;

  // ビルドの版を揃えて配る。個人データや API の返事はここに入らない。
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return (await cache.match(cachedUrl)) || fetch(request);
  })());
});
