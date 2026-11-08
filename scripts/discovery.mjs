#!/usr/bin/env node
/**
 * What coding agents and their doc indexes read about SceNoCo, derived from text the repo already
 * has — nothing here is written twice:
 *
 * - `context7.json` (committed, read by Context7 from the repo): the root package.json's description as the
 *   description, and `RULES` below as the rules an agent is handed with the docs. The card itself is
 *   indexed as a document (`folders`); the rules are its few directives, short enough for Context7.
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

/**
 * The rules Context7 hands an agent with the docs. Context7 takes rules of 255 characters at most and
 * refuses ones that look like code, so these are the card's directives in a sentence each — the
 * one place it is said twice, kept short, the first pointing to the card that says it in full.
 */
export const RULES = [
  'SceNoCo is three.js scenes written in TSX, with no React, plus Unity\'s model of behaviours. Install @scenoco-three/core and three. It is not React Three Fiber: there are no hooks.',
  'Before writing a game, read the rules card: AGENTS.md at the root of a project made with npm create @scenoco-three (packages/create/template/AGENTS.md in this repository).',
  'Every signature is in node_modules/@scenoco-three/core/API.md and in each package\'s own API.md. Search those, not the packages\' source.',
  'A scene or prefab .tsx file only declares. Each tag is a three.js class you import, and its attributes are that class\'s properties, R3F-style. No loops, branches or handlers: scenoco check reports them.',
  'Logic lives in behaviours: classes extending Behaviour in .ts files, with Unity\'s hooks in camelCase (awake, start, update, onDestroy). Public fields are settings, set as attributes of the behaviour\'s tag.',
  'Objects link through typed refs made in the scene function and passed to fields. In code, behaviours find each other with getComponent and findObjectOfType, as in Unity.',
  'Anything placed more than once is a prefab, made with prefab() around a function returning one root. Its tag sets position, rotation, scale and name. Only a prefab is instantiated.',
  'Use Unity\'s names: instantiate, destroy (deferred to the end of the frame), coroutines yielding WaitForSeconds, Input.getAxis, Time.deltaTime, SceneManager.load. Everything else is plain three.js.',
  'Motion over time is a tween, modelled on DOTween in camelCase: node.doMove(to, 0.5).setEase(Ease.OutBack). Do not lerp by hand in a coroutine.',
  'UI is HTML in index.html, written as Unity\'s UI Toolkit allows, scaled by a UIDocument. Each button has a data-button name and reads like a key: Input.getButtonDown.',
  'Physics, particles, audio, splines, terrain and post-processing are packages in Unity\'s shape: npm install @scenoco-three/rapier (or box2d, particles, audio, splines, terrain, postprocessing), then read its API.md.',
  'three.js is right-handed with y up, and rotations are radians. A camera keeps its height, as in Unity: for a phone held upright, a behaviour on the camera keeps the play area in view.',
  'Check with npm run check. In development, drive the running game through window.__scenoco (help() lists it): step a held clock, press keys, read behaviours by class.',
];

/** Context7's configuration for this repository. */
export function context7() {
  const description = summary();
  if (description.length > 500) throw new Error(`package.json's description is ${description.length} characters; Context7 takes 500.`);
  const long = RULES.find((rule) => rule.length > 255);
  if (long) throw new Error(`A Context7 rule is ${long.length} characters; it takes 255: ${long}`);
  return {
    projectTitle: 'SceNoCo',
    description,
    folders: ['packages', 'examples'],
    excludeFolders: ['tests', 'scripts', 'dist', 'node_modules', 'packages/unity/unity', 'packages/editor/src'],
    rules: RULES,
  };
}

/** The published packages: name, description and README path, core first. */
export function packages() {
  const dirs = readdirSync(join(ROOT, 'packages')).filter((d) => existsSync(join(ROOT, 'packages', d, 'package.json')));
  return dirs
    .map((dir) => ({ dir, ...JSON.parse(read(`packages/${dir}/package.json`)) }))
    .filter((p) => !p.private)
    .sort((a, b) => (a.dir === 'core' ? -1 : b.dir === 'core' ? 1 : a.dir.localeCompare(b.dir)))
    .map((p) => ({
      name: p.name,
      description: p.description,
      readme: existsSync(join(ROOT, 'packages', p.dir, 'README.md')) ? `packages/${p.dir}/README.md` : null,
      api: p.dir !== 'core' && existsSync(join(ROOT, 'packages', p.dir, 'API.md')) ? `packages/${p.dir}/API.md` : null,
    }));
}

/** Every document the site serves as markdown, in reading order: [path, label]. */
export function documents() {
  const own = packages().filter((p) => p.readme);
  return [
    ['README.md', 'SceNoCo'],
    [CARD, 'The rules a SceNoCo game project gives its coding agent (the starter\'s AGENTS.md)'],
    ['packages/core/API.md', 'Every signature of @scenoco-three/core'],
    ...own.flatMap((p) => [[p.readme, `${p.name}: ${p.description}`], ...(p.api ? [[p.api, `Every signature of ${p.name}`]] : [])]),
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
  console.log('context7.json written from package.json\'s description and the rules in scripts/discovery.mjs.');
}
