#!/usr/bin/env node
/**
 * `npm create @scenoco-three my-game` — copies the starter into `my-game`, names it, and says what
 * to run next. The starter is a game that runs: a block you steer, crates you drop, a camera that
 * follows — every verb a behaviour has, in four short files.
 */
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = process.argv[2];
if (!target || target.startsWith('-')) {
  console.error('usage: npm create @scenoco-three <folder>');
  process.exit(1);
}
const dir = resolve(target);
if (existsSync(dir) && readdirSync(dir).length > 0) {
  console.error(`${target} is not empty — pick a new folder.`);
  process.exit(1);
}

cpSync(fileURLToPath(new URL('./template', import.meta.url)), dir, { recursive: true });
// npm drops a published `.gitignore`, so the starter carries it under another name.
renameSync(join(dir, 'gitignore'), join(dir, '.gitignore'));
const manifest = join(dir, 'package.json');
const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
pkg.name = basename(dir).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
writeFileSync(manifest, `${JSON.stringify(pkg, null, 2)}\n`);

console.log(`\n  ${target} is ready:\n\n    cd ${target}\n    npm install\n    npm run dev\n\n  AGENTS.md says the whole model in a page.\n`);
