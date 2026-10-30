// One self-contained HTML file: `node tools/single.mjs` → dist-single/eggy-roll.html.
// Vite inlines every imported asset — the models and Rapier's WASM — and keeps the code in one chunk;
// this then folds the script and the styles into the page, and what the game loads by address from
// public/ — textures, sounds, the font, the sky — in as data URIs.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { build } from 'vite';
import { scenoco } from '@scenoco-three/tools/vite';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'dist-single');
const built = join(out, 'build');
await build({
  root, logLevel: 'warn', plugins: [scenoco()],
  build: { outDir: built, emptyOutDir: true, target: 'esnext', assetsInlineLimit: () => true, cssCodeSplit: false, modulePreload: false, copyPublicDir: false,
    rolldownOptions: { output: { codeSplitting: false } } },
});
let html = readFileSync(join(built, 'index.html'), 'utf8');
const assets = join(built, 'assets');
for (const file of readdirSync(assets)) {
  const text = readFileSync(join(assets, file), 'utf8');
  if (file.endsWith('.js')) html = html.replace(new RegExp(`<script[^>]*src="/assets/${file}"[^>]*></script>`), () => `<script type="module">${text.replaceAll('</script', '<\\/script')}</script>`);
  else if (file.endsWith('.css')) html = html.replace(new RegExp(`<link[^>]*href="/assets/${file}"[^>]*>`), () => `<style>${text}</style>`);
}
const TYPES = { '.jpg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const pub = join(root, 'public');
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const missing = [];
for (const file of walk(pub)) {
  const type = TYPES[extname(file)];
  if (!type) continue;
  const path = relative(pub, file);
  const uri = `data:${type};base64,${readFileSync(file).toString('base64')}`;
  const before = html.length;
  // As the CSS writes it (/ui/sky.png) and as the code does: 'textures/terrain.jpg', in any quotes.
  html = html.split(`/${path}`).join(uri);
  for (const q of ["'", '"', '`']) html = html.split(q + path + q).join(q + uri + q);
  if (html.length === before) missing.push(path);
}
const left = [...html.matchAll(/(textures|sounds|fonts|ui)\/[\w.-]+\.(jpg|png|mp3|woff2)/g)].map((m) => m[0]);
writeFileSync(join(out, 'eggy-roll.html'), html);
console.log('unused:', missing.join(', ') || '-', '| unresolved paths:', left.join(', ') || '-', '| MB:', (html.length / 1e6).toFixed(2));
