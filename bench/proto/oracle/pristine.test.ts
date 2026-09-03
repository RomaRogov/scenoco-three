import { describe, expect, it } from 'vitest';
import { arms, withSketch } from './arms.js';
import { CHECKS } from './tasks/all.js';

/**
 * Every task must *fail* on an untouched scaffold.
 *
 * A task whose check already passes before anyone has done anything is not measuring the model,
 * and this file is the guard that says so out loud. It is the same guard the game suite has, and
 * it exists because a contaminated arm once sailed through a whole pilot looking healthy.
 */
const only = process.env['BENCH_ARM'];
const built = arms().filter((arm) => !only || arm.name === only);

describe.each(built.map((arm) => [arm.name, arm] as const))('%s scaffold', (_name, arm) => {
  it.each(Object.keys(CHECKS))('does not already satisfy %s', async (task) => {
    let passed = true;
    try {
      await withSketch(arm, (sketch) => CHECKS[task]!(sketch));
    } catch {
      passed = false;
    }
    expect(passed, `the "${task}" task is already done in the ${arm.name} scaffold`).toBe(false);
  });
});
