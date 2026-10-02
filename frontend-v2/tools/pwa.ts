import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

const publicFiles = [
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
  'legal.css', 'about/index.html', 'terms/index.html', 'privacy/index.html',
];

/** HTML と同じビルドの JS/CSS を、初回インストール時にまとめて保存する。 */
export function pwaShell(): Plugin {
  return {
    name: 'cokoyo-pwa-shell',
    apply: 'build',
    generateBundle: { order: 'post', handler(_options, bundle) {
      const template = readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8');
      const files = ['index.html', ...Object.keys(bundle).filter((name) => /\.(js|css)$/.test(name)), ...publicFiles].sort();
      const digest = createHash('sha256').update(template);
      for (const name of files) {
        const file = bundle[name];
        const content = file ? (file.type === 'chunk' ? file.code : file.source)
          : readFileSync(new URL(`../public/${name}`, import.meta.url));
        digest.update(name).update(content);
      }
      this.emitFile({
        type: 'asset', fileName: 'sw.js',
        source: template.replace('__COKOYO_VERSION__', digest.digest('hex').slice(0, 16))
          .replace('__COKOYO_PRECACHE__', JSON.stringify(files.map((name) => `./${name}`))),
      });
    } },
  };
}
