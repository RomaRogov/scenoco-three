// The packages this site carries, written out as the two files that need the list.
//
// One list, in `static/package.json` — the vocabulary project, which is where "which packages does
// the editor know" is already declared. From it come the imports the compiler reads the vocabulary
// through, and the constructors the page builds nodes with. Maintaining either by hand meant three
// places to add a package to and two to forget.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const root = here('../../..');

const vocabulary = JSON.parse(readFileSync(here('../static/package.json'), 'utf8'));
const editor = JSON.parse(readFileSync(here('../package.json'), 'utf8'));

/** A dependency is a SceNoCo module when its own manifest says so. */
const modules = Object.keys(vocabulary.dependencies)
  .filter((name) => name !== 'three')
  .filter((name) => {
    const manifest = join(root, 'node_modules', name, 'package.json');
    return existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).scenoco !== undefined;
  })
  .sort();

// The page bundles these, so Vite has to be able to resolve them from the editor package itself.
// Saying so here beats a build that succeeds and a page that cannot construct half its tags.
const unresolvable = modules.filter((name) => !editor.devDependencies?.[name] && !editor.dependencies?.[name]);
if (unresolvable.length > 0) {
  throw new Error(
    `[scenoco] ${unresolvable.join(', ')} ${unresolvable.length > 1 ? 'are' : 'is'} in the vocabulary ` +
      "project but not a dependency of packages/editor, so the page could not bundle the classes. Add it there too.",
  );
}

/** `@scenoco-three/box2d` → `box2d`, a legal identifier for the namespace import. */
const local = (name) => name.split('/').pop().replace(/[^A-Za-z0-9]/g, '');

write(
  here('../app/static/registry.gen.ts'),
  `/**
 * Every class a document may name, for the standalone editor to construct from.
 *
 * GENERATED from static/package.json by scripts/static-tags.mjs — do not edit.
 *
 * three's exports, then the packages this page carries. Rapier is not among them: it is a
 * two-megabyte WebAssembly module, and a standalone viewer of documents has no physics to run.
 * A document that names its tags still opens; those nodes are inert, like every component.
 */
import * as THREE from 'three';
import '@scenoco-three/core';
${modules.map((name) => `import * as ${local(name)} from '${name}';`).join('\n')}
import type { Registry } from '../live/build.js';

export const registry: Registry = { ...THREE, ${modules.map((name) => `...${local(name)}`).join(', ')} };
`,
);

write(
  here('../static/src/tags.gen.ts'),
  `// GENERATED from package.json by scripts/static-tags.mjs — do not edit.
//
// This file is the whole point of this directory: the compiler reads a package's vocabulary
// through a real import, so a project that only *depends* on one is not enough.
${modules.map((name) => `import '${name}';`).join('\n')}
`,
);

console.log(`static-tags: ${modules.length} package(s) — ${modules.join(', ')}`);

function write(path, contents) {
  // Only when it changed: an unchanged rewrite restarts Vite's graph for nothing.
  if (existsSync(path) && readFileSync(path, 'utf8') === contents) return;
  writeFileSync(path, contents);
  console.log(`static-tags: wrote ${path.slice(dirname(here('..')).length + 1)}`);
}
