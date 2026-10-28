/**
 * `packages/core/AGENTS.md` — the rules card's "How SceNoCo works", shipped in core so an agent in a
 * project the starter did not make has it too, at `node_modules/@scenoco-three/core/AGENTS.md`.
 *
 * Written before core is packed (its `prepack`), never by hand: the starter's card is the one copy
 * anyone edits, and the starter's own layout is left out.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, howItWorks } from './discovery.mjs';

const out = join(ROOT, 'packages/core/AGENTS.md');
writeFileSync(out, `# How SceNoCo works\n\n${howItWorks()}\n`);
console.error('packages/core/AGENTS.md written from the starter\'s rules card.');
