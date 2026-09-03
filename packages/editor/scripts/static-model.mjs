// Write the vocabulary the standalone editor ships: three's tags and every tag package's, read
// by the compiler from a project that imports them all and declares nothing else.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from '@scenoco-three/compiler';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const { model } = build({ root: here('../static'), dryRun: true });
mkdirSync(here('../static/public'), { recursive: true });
writeFileSync(here('../static/public/model.json'), JSON.stringify(model));
console.log(`model.json: ${model.tags.length} tags`);
