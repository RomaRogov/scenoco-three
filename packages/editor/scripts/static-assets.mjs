// Copy the examples' documents into the static site, and list the ones that open.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
