import { describe, expect, it } from 'vitest';
import { TASKS } from '../tasks/registry.js';
import { arms, withGame } from './arms.js';
import { CHECKS } from './tasks/all.js';

/**
 * Every task oracle must **fail** on an untouched arm.
 *
 * An oracle that already passes is measuring nothing, and the mistake is invisible without this:
 * assert something the game happens to do and the task looks solved before the agent starts. It
 * would show up as a suspiciously easy task rather than as a broken one.
 *
 * This is also the check that catches a task written against the wrong numbers — if the arms all
 * pass it on day one, the task is describing the game as it already is.
 */
const built = arms();

describe('the task suite is not already solved', () => {
  it('has an oracle for every task that needs one', () => {
    const needsCheck = TASKS.filter((task) => task.id !== 'repair').map((task) => task.id);
    expect(Object.keys(CHECKS).sort()).toEqual([...needsCheck].sort());
  });

  describe.each(built.map((arm) => [arm.name, arm] as const))('%s', (_name, arm) => {
    it.each(Object.entries(CHECKS))('fails %s before the work is done', async (id, check) => {
      await expect(
        withGame(arm, (game) => check(game)),
        `${id} passes on a pristine arm — it is asserting something already true`,
      ).rejects.toThrow();
    });
  });
});
