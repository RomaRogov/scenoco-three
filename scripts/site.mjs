#!/usr/bin/env node
/**
 * The project's site, built into `site/` for GitHub Pages:
 *
 * - `index.html` — `examples/home`, a SceNoCo scene: the word falls onto a grid, and a letter can be
 *   picked up and moved as in the editor. Scrolling shrinks it into the landing page below.
 * - `<example>/` — every other example's production build, playable, in a folder of its own name.
 * - `llms.txt`, `llms-full.txt` and the markdown they link to — what coding agents read.
 * - What search engines read: the home page's title, description, preview card and structured data,
 *   its own text, which a crawler reads without running the scene, and `sitemap.xml` — submitted in the
 *   search consoles, since a project site under github.io cannot have a robots.txt of its own.
 *   `GOOGLE_SITE_VERIFICATION` and `BING_SITE_VERIFICATION`, when set, add the search consoles' tags.
 *
 * Run after `npm run build`: the examples import the built packages.
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
const title = 'SceNoCo: Unity-style three.js game framework for LLMs';
const description = escape(summary());
const page = readFileSync(join(OUT, 'index.html'), 'utf8');
const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// The page's own questions, as it shows them: structured data has to match what a reader can open.
const questions = [...page.matchAll(/<details>\s*<summary>(.*?)<\/summary>\s*<p>(.*?)<\/p>\s*<\/details>/gs)].map(([, q, a]) => ({
  '@type': 'Question',
  name: plain(q),
  acceptedAnswer: { '@type': 'Answer', text: plain(a) },
}));
const structured = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareSourceCode',
      name: 'SceNoCo',
      description: summary(),
      url: SITE,
      codeRepository: REPO,
      programmingLanguage: 'TypeScript',
      runtimePlatform: 'Web browser (WebGL, three.js)',
      license: 'https://opensource.org/licenses/MIT',
      keywords:
        'three.js game engine, three.js game framework, Unity-like web game engine, Unity for the web, vibe coding games, vibe code a game, AI game development, game development with LLMs, AI coding agents, browser games, TSX, TypeScript, WebGL',
    },
    { '@type': 'FAQPage', url: SITE, mainEntity: questions },
  ],
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
const index = join(OUT, 'index.html');
writeFileSync(
  index,
  page
    .replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>`)
    .replace('</head>', `  ${head.join('\n    ')}\n  </head>`),
);

// For crawlers: what there is.
const pages = ['', ...examples.map((e) => `${e.name}/`), 'llms.txt', 'llms-full.txt', ...documents().map(([path]) => path)];
writeFileSync(
  join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .map((path) => `  <url><loc>${SITE}${path}</loc></url>`)
    .join('\n')}\n</urlset>\n`,
);

// What agents read: llms.txt, the full text, and each document it links to, at its repo path.
writeFileSync(join(OUT, 'llms.txt'), llmsTxt());
writeFileSync(join(OUT, 'llms-full.txt'), llmsFullTxt());
for (const [path] of documents()) {
  mkdirSync(dirname(join(OUT, path)), { recursive: true });
  copyFileSync(join(ROOT, path), join(OUT, path));
}
writeFileSync(join(OUT, '.nojekyll'), '');
console.log(`site/ built: the home page, ${examples.map((e) => e.name).join(', ')}, llms.txt and ${documents().length} documents.`);
