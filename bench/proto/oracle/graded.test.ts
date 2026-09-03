import { describe, expect, it } from 'vitest';
import { arms, withSketch } from './arms.js';
import { CHECKS } from './tasks/all.js';

/** Grade one scaffold against one prototype task — the entry point the runner spawns. */
const arm = process.env['BENCH_ARM'];
const task = process.env['BENCH_TASK'];

if (!arm || !task) {
  describe.skip('proto graded', () => {
    it('needs BENCH_ARM and BENCH_TASK', () => {
      expect(true).toBe(true);
    });
  });
} else {
  const found = arms().find((candidate) => candidate.name === arm);
  const check = CHECKS[task];

  describe(`proto ${arm} · ${task}`, () => {
    it('satisfies the task', async () => {
      if (!found) throw new Error(`no prototype arm called "${arm}"`);
      if (!check) throw new Error(`no prototype task called "${task}"`);
      await withSketch(found, (sketch) => check(sketch));
    });
  });
}
