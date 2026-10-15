#!/usr/bin/env node
/**
 * The project's site, built into `site/` for GitHub Pages:
 *
 * - `index.html` — `examples/home`, a SceNoCo scene: the word falls onto a grid, and a letter can be
 *   picked up and moved as in the editor. Its one button leads to the README.
 * - `breakout/`, `subway/` — the examples' production builds, playable.
 * - `editor.js` — the editor's interface, for a game opened with `?edit=<site>/editor.js`.
 * - `llms.txt`, `llms-full.txt` and the markdown they link to — what coding agents read.
 *
 * Run after `npm run build`: the examples import the built packages, and the editor is its build.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { build } from 'vite';
import { ROOT, documents, llmsFullTxt, llmsTxt, summary } from './discovery.mjs';

const OUT = join(ROOT, 'site');

rmSync(OUT, { recursive: true, force: true });

// The home page at the root first, then the examples in folders beside it — each built to run from where it lands.
for (const [name, outDir] of [['home', OUT], ['breakout', join(OUT, 'breakout')], ['subway', join(OUT, 'subway')]]) {
  await build({ root: join(ROOT, 'examples', name), base: './', logLevel: 'warn', build: { outDir, emptyOutDir: true } });
}

// What a search result or a link preview shows: the project's one sentence, from package.json.
const index = join(OUT, 'index.html');
const description = summary().replace(/&/g, '&amp;').replace(/"/g, '&quot;');
writeFileSync(index, readFileSync(index, 'utf8').replace('</head>', `  <meta name="description" content="${description}" />\n  </head>`));

const editor = join(ROOT, 'packages/editor/dist/editor.js');
if (!existsSync(editor)) throw new Error('packages/editor/dist/editor.js is missing — run `npm run build` first.');
copyFileSync(editor, join(OUT, 'editor.js'));

// What agents read: llms.txt, the full text, and each document it links to, at its repo path.
writeFileSync(join(OUT, 'llms.txt'), llmsTxt());
writeFileSync(join(OUT, 'llms-full.txt'), llmsFullTxt());
for (const [path] of documents()) {
  mkdirSync(dirname(join(OUT, path)), { recursive: true });
  copyFileSync(join(ROOT, path), join(OUT, path));
}
writeFileSync(join(OUT, '.nojekyll'), '');
console.log(`site/ built: the home page, breakout, subway, the editor, llms.txt and ${documents().length} documents.`);
