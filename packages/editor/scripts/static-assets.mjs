// Copy the examples' documents into the static site, each with the model its build reads, and
// list the ones that open.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, MODEL_FILE } from '@scenoco-three/compiler';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const examples = here('../../../examples');
const out = here('../static/public/examples');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const pickable = [];
for (const name of ['collector', 'breakout', 'playable', 'castle']) {
  const assets = join(examples, name, 'assets');
  if (!existsSync(assets)) continue;
  cpSync(assets, join(out, name, 'assets'), { recursive: true, filter: (src) => !src.endsWith('.gen.ts') });
  // The page has no checker to read an example's components with; the build that compiles the
  // example does, and what it read goes beside the documents exactly as it does in a project.
  //
  // Everything the build leaves under `.scenoco`, not only the model: a component's preview is an
  // artifact the page fetches from beside it, so an example that has one has to carry it too.
  const root = join(examples, name);
  const built = build({ root, dryRun: true }).files;
  let model;
  for (const [path, contents] of built) {
    const inside = relative(join(root, '.scenoco'), path);
    if (inside.startsWith('..')) continue;
    const target = join(out, name, '.scenoco', inside);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
    if (path === join(root, MODEL_FILE)) model = contents;
  }
  // Which kinds are a thing to *open*: a scene and a prefab always, plus whatever this example's
  // own packages declared. The rest are referenced by path from inside one.
  const openable = new Set(['scene', 'prefab', ...(JSON.parse(model).documents ?? []).map((d) => d.kind)]);
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, `${prefix}${entry}/`);
      else {
        const match = /^(.*)\.([A-Za-z][A-Za-z0-9-]*)\.xml$/.exec(entry);
        if (match && openable.has(match[2])) pickable.push({ kind: match[2], path: `examples/${name}/assets/${prefix}${entry}`, stem: match[1], group: name });
      }
    }
  };
  walk(assets, '');
}
writeFileSync(here('../static/public/examples.json'), JSON.stringify(pickable, null, 2));
console.log(`examples.json: ${pickable.length} documents`);
