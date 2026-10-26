#!/usr/bin/env node
/**
 * The project's site, built into `site/` for GitHub Pages:
 *
 * - `index.html` — `examples/home`, a SceNoCo scene: the word falls onto a grid, and a letter can be
 *   picked up and moved as in the editor. One button leads to the README, another shows its source.
 * - `<example>/` — every other example's production build, playable, in a folder of its own name.
 * - `editor.js` — the editor's interface, for a game opened with `?edit=<site>/editor.js`.
 * - `llms.txt`, `llms-full.txt` and the markdown they link to — what coding agents read.
 * - What search engines read: the home page's title, description, preview card and structured data,
 *   the same in text for a crawler that does not run the scene, and `sitemap.xml` — submitted in the
 *   search consoles, since a project site under github.io cannot have a robots.txt of its own.
 *   `GOOGLE_SITE_VERIFICATION` and `BING_SITE_VERIFICATION`, when set, add the search consoles' tags.
 *
 * Run after `npm run build`: the examples import the built packages, and the editor is its build.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { build } from 'vite';
import { REPO, ROOT, SITE, documents, llmsFullTxt, llmsTxt, summary } from './discovery.mjs';

const OUT = join(ROOT, 'site');

rmSync(OUT, { recursive: true, force: true });

// Every example with a page: the home page at the root, the rest in folders beside it by name.
const examples = readdirSync(join(ROOT, 'examples'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== 'home' && existsSync(join(ROOT, 'examples', d.name, 'index.html')))
  .map((d) => ({ name: d.name, title: /<title>([^<]*)<\/title>/.exec(readFileSync(join(ROOT, 'examples', d.name, 'index.html'), 'utf8'))?.[1] ?? d.name }));

// The home page first: each build empties its folder, and the root's would take the others with it.
// `base: './'`, so each runs from wherever it lands — and an example's own files are page-relative.
for (const [name, outDir] of [['home', OUT], ...examples.map((e) => [e.name, join(OUT, e.name)])]) {
  await build({ root: join(ROOT, 'examples', name), base: './', logLevel: 'warn', build: { outDir, emptyOutDir: true } });
}

// What a search result or a link preview shows: the project's one sentence, from package.json.
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const title = 'SceNoCo — Unity-style behaviours for three.js, scenes in TSX';
const description = escape(summary());
const structured = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareSourceCode',
  name: 'SceNoCo',
  description: summary(),
  url: SITE,
  codeRepository: REPO,
  programmingLanguage: 'TypeScript',
  runtimePlatform: 'Web browser (WebGL, three.js)',
  license: 'https://opensource.org/licenses/MIT',
  keywords: 'three.js, game engine, Unity, TSX, TypeScript, WebGL, game development, AI coding agents',
};
const verification = [
  ['google-site-verification', process.env.GOOGLE_SITE_VERIFICATION],
  ['msvalidate.01', process.env.BING_SITE_VERIFICATION],
].filter(([, token]) => token);
const head = [
  `<meta name="description" content="${description}" />`,
  `<link rel="canonical" href="${SITE}" />`,
  `<meta property="og:type" content="website" />`,
  `<meta property="og:site_name" content="SceNoCo" />`,
  `<meta property="og:title" content="${escape(title)}" />`,
  `<meta property="og:description" content="${description}" />`,
  `<meta property="og:url" content="${SITE}" />`,
  `<meta property="og:image" content="${SITE}og.png" />`,
  `<meta property="og:image:width" content="1200" />`,
  `<meta property="og:image:height" content="630" />`,
  `<meta name="twitter:card" content="summary_large_image" />`,
  `<meta name="twitter:image" content="${SITE}og.png" />`,
  ...verification.map(([name, token]) => `<meta name="${name}" content="${escape(token)}" />`),
  `<script type="application/ld+json">${JSON.stringify(structured)}</script>`,
];
// The page itself is a scene on a canvas: this is what it says in words, for whoever cannot see it —
// a screen reader, a crawler — and the links a crawler follows from here.
const links = [
  ['README', `${REPO}#readme`],
  ['API reference', `${SITE}packages/core/API.md`],
  ...examples.map((e) => [`${e.title.replace(/ — SceNoCo$/, '')}, playable`, `${SITE}${e.name}/`]),
  ['llms.txt', `${SITE}llms.txt`],
  ['Source on GitHub', REPO],
  ['@scenoco-three/core on npm', 'https://www.npmjs.com/package/@scenoco-three/core'],
];
const words = `
    <main class="words">
      <h1>SceNoCo</h1>
      <p>${description}</p>
      <p>Scene · Node · Component: a three.js scene is a TSX file that only declares, and its logic lives in
      Unity-style behaviours — awake, start, update, coroutines, prefabs, physics and input. Start a game with
      <code>npm create @scenoco-three my-game</code>.</p>
      <ul>${links.map(([label, href]) => `<li><a href="${href}">${label}</a></li>`).join('')}</ul>
    </main>`;
const style = `.words { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }`;
const index = join(OUT, 'index.html');
writeFileSync(
  index,
  readFileSync(index, 'utf8')
    .replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>`)
    .replace('</style>', `  ${style}\n    </style>`)
    .replace('</head>', `  ${head.join('\n    ')}\n  </head>`)
    .replace('<body>', `<body>${words}`),
);

// For crawlers: what there is.
const pages = ['', ...examples.map((e) => `${e.name}/`), 'llms.txt', 'llms-full.txt', ...documents().map(([path]) => path)];
writeFileSync(
  join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .map((path) => `  <url><loc>${SITE}${path}</loc></url>`)
    .join('\n')}\n</urlset>\n`,
);

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
console.log(`site/ built: the home page, ${examples.map((e) => e.name).join(', ')}, the editor, llms.txt and ${documents().length} documents.`);
