// Copy the examples' documents into the static site, each with the model its build reads, and
// list the ones that open.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
  const root = join(examples, name);
  const model = build({ root, dryRun: true }).files.get(join(root, MODEL_FILE));
  mkdirSync(dirname(join(out, name, MODEL_FILE)), { recursive: true });
  writeFileSync(join(out, name, MODEL_FILE), model);
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, `${prefix}${entry}/`);
      else {
        const match = /^(.*)\.(scene|prefab)\.xml$/.exec(entry);
        if (match) pickable.push({ kind: match[2], path: `examples/${name}/assets/${prefix}${entry}`, stem: match[1], group: name });
      }
    }
  };
  walk(assets, '');
}
writeFileSync(here('../static/public/examples.json'), JSON.stringify(pickable, null, 2));
console.log(`examples.json: ${pickable.length} documents`);
