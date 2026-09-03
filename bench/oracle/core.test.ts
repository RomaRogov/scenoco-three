import { describe, expect, it } from 'vitest';
import { arms, named, run, walk, walkTo, withGame } from './arms.js';

/**
 * The invariants no task is allowed to break — the regression check.
 *
 * Separate from `parity.test.ts`, and the distinction cost a pilot run to learn. Parity pins the
 * game *exactly*: ten crates, six units a second, one point a crate. That is right for proving
 * the arms are the same game, and wrong for asking "did this cell break something", because half
 * the suite asks for one of those numbers to change. Graded against parity, an agent that
 * correctly made a crate worth three would be recorded as having broken the game.
 *
 * So this file asserts only what survives every task in the registry: the player moves and stays
 * in the arena, a crate can be collected, a stack can be banked, the clock runs, and the whole
 * thing is deterministic. No exact quantity that any task is entitled to change.
 */
const only = process.env['BENCH_ARM'];
const built = arms().filter((arm) => !only || arm.name === only);

describe.each(built.map((arm) => [arm.name, arm] as const))('%s', (_name, arm) => {
  it('has a player that moves under input and stops without it', async () => {
    await withGame(arm, (game) => {
      const player = named(game, 'player');
      const start = player.position.clone();

      walk(game, 1, 0, 0.5);
      const moved = start.distanceTo(player.position);
      expect(moved, 'the player did not move at all').toBeGreaterThan(0.1);

      const parked = player.position.clone();
      run(game, 0.5);
      expect(parked.distanceTo(player.position), 'the player drifts with no input').toBeCloseTo(0, 3);
    });
  });

  it('keeps the player inside the arena', async () => {
    await withGame(arm, (game) => {
      const player = named(game, 'player');
      walk(game, 1, 0, 10);
      walk(game, 0, 1, 10);
      expect(Math.abs(player.position.x)).toBeLessThanOrEqual(10);
      expect(Math.abs(player.position.z)).toBeLessThanOrEqual(10);
    });
  });

  it('collects a crate by reaching it', async () => {
    await withGame(arm, (game) => {
      const crate = named(game, 'crate');
      const before = game.state.cratesRemaining;
      expect(before, 'the arena starts with no crates').toBeGreaterThan(0);

      walkTo(game, crate.position.x, crate.position.z);
      expect(game.state.carried).toBeGreaterThan(0);
      expect(game.state.cratesRemaining).toBeLessThan(before);
    });
  });

  it('banks a stack at the depot', async () => {
    await withGame(arm, (game) => {
      const crate = named(game, 'crate');
      walkTo(game, crate.position.x, crate.position.z);
      expect(game.state.carried, 'nothing was picked up to bank').toBeGreaterThan(0);

      // The depot's *live* position: one task makes it drift, and a regression check that
      // assumed the origin would fail on a task that was done correctly.
      const depot = named(game, 'depot');
      walkTo(game, depot.position.x, depot.position.z);

      expect(game.state.carried).toBe(0);
      expect(game.state.score).toBeGreaterThan(0);
    });
  });

  it('runs a clock that falls and floors at zero', async () => {
    await withGame(arm, (game) => {
      const start = game.state.timeLeft;
      expect(start).toBeGreaterThan(0);
      run(game, 5);
      expect(game.state.timeLeft).toBeLessThan(start);
      run(game, start + 30);
      expect(game.state.timeLeft).toBe(0);
    });
  });

  it('is deterministic', async () => {
    const play = async (): Promise<string> => {
      let seen = '';
      await withGame(arm, (game) => {
        const crate = named(game, 'crate');
        walkTo(game, crate.position.x, crate.position.z);
        walkTo(game, 0, 0);
        seen = JSON.stringify({
          score: game.state.score,
          carried: game.state.carried,
          left: game.state.cratesRemaining,
        });
      });
      return seen;
    };
    expect(await play()).toBe(await play());
  });
});
