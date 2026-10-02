import { useSyncExternalStore } from 'react';

export const pwaEnabled = import.meta.env.PROD && import.meta.env.VITE_SHELL === 'app';
let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();
const setWaiting = (worker: ServiceWorker | null) => {
  waiting = worker;
  listeners.forEach((listener) => listener());
};

export function registerPwa() {
  if (!pwaEnabled || !('serviceWorker' in navigator) || !window.isSecureContext) return;

  const register = async () => {
    try {
      const base = new URL(import.meta.env.BASE_URL, window.location.href);
      const registration = await navigator.serviceWorker.register(new URL('sw.js', base), {
        scope: base.href, updateViaCache: 'none',
      });
      const checkWaiting = () => setWaiting(navigator.serviceWorker.controller ? registration.waiting : null);
      const watchInstalling = () => registration.installing?.addEventListener('statechange', checkWaiting);
      registration.addEventListener('updatefound', watchInstalling);
      watchInstalling();
      checkWaiting();
      let controlled = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        setWaiting(null);
        // 複数のタブで開いていても、更新後の HTML と JS の版を揃える。
        if (controlled) window.location.reload();
        controlled = true;
      });
      const checkUpdate = () => {
        if (navigator.onLine && document.visibilityState === 'visible') {
          void registration.update().catch(() => { /* オフライン中は今の版を使う */ });
        }
      };
      document.addEventListener('visibilitychange', checkUpdate);
      window.addEventListener('online', checkUpdate);
    } catch { /* 登録できなくても通常のサイトとして動く */ }
  };
  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', () => void register(), { once: true });
}

export function usePwaUpdate() {
  const worker = useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => waiting,
  );
  return {
    updateReady: !!worker,
    update: () => {
      if (!worker) return;
      worker.postMessage({ type: 'SKIP_WAITING' });
    },
  };
}
