import { useEffect, useState } from 'react';
import { pwaEnabled, usePwaUpdate } from '../app/pwa';

export function PwaNotice() {
  const [online, setOnline] = useState(navigator.onLine);
  const { updateReady, update } = usePwaUpdate();
  useEffect(() => {
    const change = () => setOnline(navigator.onLine);
    window.addEventListener('online', change);
    window.addEventListener('offline', change);
    return () => {
      window.removeEventListener('online', change);
      window.removeEventListener('offline', change);
    };
  }, []);
  if (!pwaEnabled || (online && !updateReady)) return null;
  return (
    <div className="pwa-notice" role="status" aria-live="polite">
      {!online ? <span>オフラインです。在校確認やログインには通信が必要です。</span> : (
        <>
          <span>新しいバージョンが使えます。</span>
          <button className="mini-btn primary" onClick={update}>更新する</button>
        </>
      )}
    </div>
  );
}
