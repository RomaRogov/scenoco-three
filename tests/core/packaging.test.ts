import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The `sideEffects` field, against the imports it exists to protect.
 *
 * Every `augment/*` module patches a THREE prototype and exports nothing, so a bundler that
 * believes the package is side-effect-free is entitled to delete it. `sideEffects` is the only
 * thing standing between that and a broken game — and it is a hand-maintained list beside a set
 * of imports, which is exactly the shape that goes stale.
 *
 * It did. `@scenoco-three/core@0.5.0` shipped naming two of the five, so `vite build` dropped
 * `components`, `prefabs` and `lifetime`: `addComponent` was simply not a function, in a project
 * that installed the package rather than developing inside this workspace. Nothing here caught it
 * because every test in this repo imports the source directly, where no bundler is involved.
 */
const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../packages/core/${relative}`, import.meta.url)), 'utf8');

describe('the core package manifest', () => {
  /**
   * `true`, not a list. The list matched the imports, and it was still not enough: the standalone
   * editor's site build (Vite 8 on rolldown, reaching the package through a workspace symlink)
   * dropped the `Scene` augmentation anyway, and the first document opened with `load is not a
   * function`. The package is three thousand lines whose imports are its point; there is nothing
   * worth shaking out of it at the cost of that, and `true` is the one value that cannot rot.
   */
  it('declares the whole package a side effect, so no bundler can drop an augmentation', () => {
    const index = read('src/index.ts');
    const manifest = JSON.parse(read('package.json')) as { sideEffects: unknown };
    const imported = [...index.matchAll(/^import '\.\/(runtime\/augment\/[a-z0-9]+)\.js';$/gm)];
    expect(imported.length).toBeGreaterThan(0); // the augmentations are still side-effect imports
    expect(manifest.sideEffects).toBe(true);
  });
});
