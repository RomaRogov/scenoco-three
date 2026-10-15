#!/usr/bin/env node
/**
 * `scenoco check [dir...]` — every `.tsx` file under the given folders (the current one by
 * default) is a scene, and a scene only declares. Types are `tsc`'s job; this is the other half.
 */
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import process from 'node:process';
import { checkScene, tsxFiles } from './scenes.js';

const [command, ...dirs] = process.argv.slice(2);
if (command !== 'check') {
  console.error('usage: scenoco check [dir...]   — every .tsx file is a scene, and a scene only declares');
  process.exit(command === undefined || command === '-h' || command === '--help' ? 0 : 1);
}
const problems = (dirs.length ? dirs : ['.'])
  .flatMap((dir) => [...tsxFiles(dir)])
  .flatMap((file) => checkScene(relative(process.cwd(), file), readFileSync(file, 'utf8')));
for (const problem of problems) console.error(problem);
if (problems.length) {
  console.error(`\n${problems.length} problem(s). A .tsx file is a scene: it declares, and behaviours (.ts) do the rest.`);
  process.exit(1);
}
