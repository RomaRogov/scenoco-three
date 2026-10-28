#!/usr/bin/env node
/**
 * What coding agents and their doc indexes read about SceNoCo, derived from text the repo already
 * has — nothing here is written twice:
 *
 * - `context7.json` (committed, read by Context7 from the repo): the root package.json's description as the
 *   description, and the starter's rules card as the rules an agent is handed with the docs.
 * - `llms.txt` and `llms-full.txt` (built into the site by `scripts/site.mjs`): that description
 *   paragraph, then links to the docs, labelled by each package's own description.
 *
 * `node scripts/discovery.mjs` rewrites `context7.json`; a test fails when it is out of date.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const REPO = 'https://github.com/RomaRogov/scenoco-three';
export const SITE = 'https://romarogov.github.io/scenoco-three/';
const CARD = 'packages/create/template/AGENTS.md';

const read = (path) => readFileSync(join(ROOT, path), 'utf8');

/**
 * The project in one sentence: the root package.json's `description`. Plain text, so every place
 * shows it as is — and it is not the README, which is free to read as a letter.
 */
export function summary() {
  const { description } = JSON.parse(read('package.json'));
  if (!description) throw new Error('package.json has no description: it is the one sentence the indexes show.');
  return description;
}

/** The rules card's "How SceNoCo works" section: everything but the starter's own layout. */
export function howItWorks() {
  const section = read(CARD).split(/^# How SceNoCo works\s*$/m)[1];
  if (!section) throw new Error(`${CARD} has no "# How SceNoCo works" section.`);
  return section.trim();
}

/** The rules card's "How SceNoCo works" paragraphs, its Unity mapping last — each as one line. */
export function rules() {
  return howItWorks()
    .split(/\n\s*\n/)
    .map((text) => text.replace(/\s*\n\s*/g, ' ').trim());
}

/** Context7's configuration for this repository. */
export function context7() {
  const description = summary();
  if (description.length > 500) throw new Error(`package.json's description is ${description.length} characters; Context7 takes 500.`);
  return {
    projectTitle: 'SceNoCo',
    description,
    folders: ['packages', 'examples'],
    excludeFolders: ['tests', 'scripts', 'dist', 'node_modules', 'packages/unity/unity', 'packages/editor/src'],
    rules: rules(),
  };
}

/** The published packages: name, description and README path, core first. */
export function packages() {
  const dirs = readdirSync(join(ROOT, 'packages')).filter((d) => existsSync(join(ROOT, 'packages', d, 'package.json')));
  return dirs
    .map((dir) => ({ dir, ...JSON.parse(read(`packages/${dir}/package.json`)) }))
    .filter((p) => !p.private)
    .sort((a, b) => (a.dir === 'core' ? -1 : b.dir === 'core' ? 1 : a.dir.localeCompare(b.dir)))
    .map((p) => ({ name: p.name, description: p.description, readme: existsSync(join(ROOT, 'packages', p.dir, 'README.md')) ? `packages/${p.dir}/README.md` : null }));
}

/** Every document the site serves as markdown, in reading order: [path, label]. */
export function documents() {
  const own = packages().filter((p) => p.readme);
  return [
    ['README.md', 'SceNoCo'],
    [CARD, 'The rules a SceNoCo game project gives its coding agent (the starter\'s AGENTS.md)'],
    ['packages/core/API.md', 'Every signature of @scenoco-three/core'],
    ...own.map((p) => [p.readme, `${p.name}: ${p.description}`]),
  ];
}

export function llmsTxt(site = SITE) {
  const [readme, card, api, ...rest] = documents();
  const link = ([path, label]) => `- [${path}](${site}${path}): ${label}`;
  return [
    '# SceNoCo',
    '',
    `> ${summary()}`,
    '',
    `Start a game with \`npm create @scenoco-three my-game\`. Source: ${REPO}`,
    '',
    '## Docs',
    '',
    link(readme),
    link(card),
    link(api),
    '',
    '## Packages',
    '',
    ...rest.map(link),
    '',
    '## Optional',
    '',
    `- [llms-full.txt](${site}llms-full.txt): every document above in one file`,
    '',
  ].join('\n');
}

export function llmsFullTxt() {
  return documents()
    .map(([path]) => `<!-- ${path} -->\n\n${read(path).trim()}\n`)
    .join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(ROOT, 'context7.json'), JSON.stringify(context7(), null, 2) + '\n');
  console.log('context7.json written from package.json\'s description and the starter\'s rules card.');
}
