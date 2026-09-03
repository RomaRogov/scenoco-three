import { describe, expect, it } from 'vitest';
import { arms, named, run, withSketch } from './arms.js';

/**
 * What a scaffold must still do after a task has been added to it — the regression check.
 *
 * The starter is a lit, turning cube on a ground. A task asks for something *else* to be added,
 * so anything that breaks these three facts broke the project while extending it. Deliberately
 * narrow: no task in the registry has any business touching them.
 */
const only = process.env['BENCH_ARM'];
const built = arms().filter((arm) => !only || arm.name === only);

describe.each(built.map((arm) => [arm.name, arm] as const))('%s', (_name, arm) => {
  it('still has its ground', async () => {
    await withSketch(arm, (sketch) => {
      expect(() => named(sketch, 'ground')).not.toThrow();
    });
  });

  it('still has its block', async () => {
    await withSketch(arm, (sketch) => {
      expect(() => named(sketch, 'block')).not.toThrow();
    });
  });

  it('still turns the block', async () => {
    await withSketch(arm, (sketch) => {
      const block = named(sketch, 'block');
      const before = block.rotation.y;
      run(sketch, 1);
      expect(Math.abs(block.rotation.y - before), 'the block stopped turning').toBeGreaterThan(0.1);
    });
  });
});
