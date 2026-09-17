// Write the vocabulary the standalone editor ships: three's tags and every tag package's, read
// by the compiler from a project that imports them all and declares nothing else.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, MODEL_FILE } from '@scenoco-three/compiler';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const root = here('../static');
// The *written* model, not the one in memory: that is the one with portable paths and with the
// document kinds these packages declare, and it is what a project's own `.scenoco/model.json`
// holds. A page that read a different shape here would be reading a second format.
const written = build({ root, dryRun: true }).files.get(join(root, MODEL_FILE));
mkdirSync(here('../static/public'), { recursive: true });
writeFileSync(here('../static/public/model.json'), written);
const model = JSON.parse(written);
console.log(`model.json: ${model.tags.length} tags, ${(model.documents ?? []).length} document kind(s)`);
