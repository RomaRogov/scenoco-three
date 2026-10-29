// One self-contained HTML file: `node tools/single.mjs` → dist-single/breakout.html.
// Vite inlines every imported asset as a data URI — the sound chips' WASM included — and keeps the
// code in one chunk; this then folds the script and the styles into the page itself.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';
import { scenoco } from '@scenoco-three/tools/vite';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'dist-single');
await build({
  root,
  logLevel: 'warn',
  plugins: [scenoco()],
  build: {
    outDir: join(out, 'build'),
    emptyOutDir: true,
    target: 'esnext',
    assetsInlineLimit: () => true,
    cssCodeSplit: false,
    modulePreload: false,
    rolldownOptions: { output: { codeSplitting: false } },
  },
});

const built = join(out, 'build');
let html = readFileSync(join(built, 'index.html'), 'utf8');
const assets = join(built, 'assets');
for (const file of readdirSync(assets)) {
  const text = readFileSync(join(assets, file), 'utf8');
  if (file.endsWith('.js')) {
    html = html.replace(new RegExp(`<script[^>]*src="/assets/${file}"[^>]*></script>`), () => `<script type="module">${text.replaceAll('</script', '<\\/script')}</script>`);
  } else if (file.endsWith('.css')) {
    html = html.replace(new RegExp(`<link[^>]*href="/assets/${file}"[^>]*>`), () => `<style>${text}</style>`);
  }
}
const left = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
if (left.length) throw new Error(`not inlined: ${left.join(', ')}`);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'breakout.html'), html);
console.log(`dist-single/breakout.html ${(html.length / 1e6).toFixed(2)} MB`);
