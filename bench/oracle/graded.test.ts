import { describe, expect, it } from 'vitest';
import { arms, withGame } from './arms.js';
import { CHECKS } from './tasks/all.js';

/**
 * Grade one arm against one task — the entry point the runner spawns after an agent has worked.
 *
 * Run through vitest rather than imported into the runner because one arm's seam is `.tsx`, and
 * grading React by hand-rolling a JSX transform would be a second toolchain to keep correct.
 *
 * Two verdicts, and the difference between them is the point of the study:
 *
 *  - **regressed** — the parity suite no longer passes. The agent broke the game while changing it.
 *  - **passed** — the task's own oracle is satisfied.
 *
 * A run that builds cleanly, claims to be finished, and fails here is the headline number:
 * *silently wrong*. Nothing told the agent, so nothing could have told it.
 */
const arm = process.env['BENCH_ARM'];
const task = process.env['BENCH_TASK'];

// Skipped rather than thrown when unaddressed, so this file can sit in the same suite as the
// parity checks without turning `npm run oracle` red for everyone who is not grading a run.
if (!arm || !task) {
  describe.skip('graded', () => {
    it('needs BENCH_ARM and BENCH_TASK', () => {});
  });
} else {
  const found = arms().find((candidate) => candidate.name === arm);
  const check = CHECKS[task];

  describe(`${arm} · ${task}`, () => {
    it('does what was asked', async () => {
      if (!found) throw new Error(`no built arm called "${arm}"`);
      if (!check) throw new Error(`no oracle for task "${task}"`);
      await withGame(found, (game) => check(game));
    });
  });
}
