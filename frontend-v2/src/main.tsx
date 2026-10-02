import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { shell } from './config';
import { registerPwa } from './app/pwa';
import './styles.css';

// 本番はスマホ枠を外して画面いっぱいに出す（styles.css の body.plain）
if (shell === 'app') document.body.classList.add('plain');

// 本番アプリだけで、画面の読み込み後に PWA を登録する。
registerPwa();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
