#!/usr/bin/env node
// Production-build smoke test (SceNoCo fix-plan P1-1).
//
// Both P0 bugs that motivated this script were invisible to the unit suite and
// the editor's MCP-driven testing — they only appeared in a real `vite build`,
// where tree-shaking and module-evaluation order differ from dev/test. The unit
// suite structurally can't catch them: it never goes through a bundler.
//
// So this runs a real singlefile (IIFE) production build of an example and
// asserts the load-bearing runtime plumbing survived minification/tree-shaking.
// It does NOT render or play the scene (that's the "one real Chrome tab over
// MCP" workflow) — it only checks "does the production bundle still contain the
// code that would otherwise silently vanish."

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const example = 'examples/breakout';
const outDir = mkdtempSync(join(tmpdir(), 'scenoco-smoke-'));

/** Each check: a label, a matcher against the built bundle, and why it matters. */
const checks = [
  {
    label: 'node-augment side-effect module survived tree-shaking',
    // Unique string from node-augment.ts's error message. Its bare
    // side-effect-only import is exactly what a bundler may drop if package.json
    // `sideEffects` doesn't list it (fix-plan P0-1).
    re: /requires the node to be in an engine/,
    why: 'core/package.json `sideEffects` must list runtime/node-augment so the Object3D prototype patch is kept.',
  },
  {
    label: 'Object3D.prototype component API patch survived minification',
    re: /getComponent\s*=\s*function|prototype\.getComponent/,
    why: 'without the actual prototype assignment, every component onLoad/update throws `getComponent is not a function`.',
  },
  {
    label: 'inline sourcemap present (file://-safe debugging)',
    re: /sourceMappingURL=data:application\/json/,
    why: 'the singlefile build sets `sourcemap: "inline"` so a minified crash maps back to source (fix-plan P1-2).',
  },
];

console.log(`[build-smoke] building ${example} (singlefile/IIFE) → ${outDir}`);
try {
  execFileSync(
    'npm',
    ['--prefix', example, 'run', 'build', '--', '--outDir', outDir, '--emptyOutDir'],
    { cwd: repoRoot, stdio: ['ignore', 'inherit', 'inherit'] },
  );

  const html = readFileSync(join(outDir, 'index.html'), 'utf8');
  const failures = checks.filter((c) => !c.re.test(html));

  for (const c of checks) console.log(`  ${failures.includes(c) ? '✗' : '✓'} ${c.label}`);

  if (failures.length > 0) {
    console.error('\n[build-smoke] FAILED — the production bundle is missing load-bearing code:');
    for (const c of failures) console.error(`  ✗ ${c.label}\n    ${c.why}`);
    process.exit(1);
  }
  console.log('\n[build-smoke] OK — production bundle contains all required runtime plumbing.');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
