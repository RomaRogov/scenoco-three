// Every platform's native binary is in the lockfile, not only the platform it was written on.
//
// npm drops the optional dependencies it did not install when it rewrites a lockfile from an
// existing node_modules (npm/cli#4828). A lockfile written on a Mac then names only the darwin
// build of TypeScript's native compiler, and `npm ci` on Linux installs no compiler at all —
// the failure surfaces much later, as `tsc` unable to resolve @typescript/typescript-linux-x64.
//
// Repair: delete the affected entries from package-lock.json and run
// `npm install --package-lock-only --legacy-peer-deps`.

import { readFileSync } from 'node:fs';

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const entries = lock.packages;

/** Where npm would find `name` from the package at `from`: its own node_modules, then upward. */
function resolves(from, name) {
  for (let dir = from; ; dir = dir.slice(0, Math.max(0, dir.lastIndexOf('/node_modules')))) {
    if (entries[`${dir ? `${dir}/` : ''}node_modules/${name}`]) return true;
    if (!dir) return false;
  }
}

const missing = [];
for (const [path, entry] of Object.entries(entries)) {
  for (const name of Object.keys(entry.optionalDependencies ?? {})) {
    if (!resolves(path, name)) missing.push(`${path || '(root)'} → ${name}`);
  }
}

if (missing.length) {
  console.error(`package-lock.json lacks ${missing.length} optional dependencies, so npm ci skips them on the platforms they are for:`);
  for (const line of missing) console.error(`  ${line}`);
  console.error('Delete the entries of the packages named on the left, then run: npm install --package-lock-only --legacy-peer-deps');
  process.exit(1);
}
console.log('package-lock.json names every platform build.');
