import type { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { arms, run, walk, walkTo, withGame } from './arms.js';

/**
 * The parity suite: the game every arm has to be.
 *
 * This is not a task. It is the proof that the arms are the same game, and it runs before any
 * agent is allowed near them — an arm that cannot pass this means every later measurement is
 * measuring that arm's bugs rather than its framework.
 *
 * Every assertion here is normative. Where an arm disagrees, the arm is wrong and
 * should be changed first.
 */
/**
 * Scoped to one arm when `BENCH_ARM` is set.
 *
 * The runner uses this suite to ask "did this cell break the game", and the answer has to be
 * about *this* arm. Run across all of them, a cell would be blamed for a sibling's breakage —
 * which is exactly what happened the first time a stray edit landed in another arm.
 */
const only = process.env['BENCH_ARM'];
const built = arms().filter((arm) => !only || arm.name === only);

if (built.length === 0) {
  describe('parity', () => {
    it.skip('no arm is installed — run `npm run install:arms && npm run build:arms`', () => {});
  });
}

describe.each(built.map((arm) => [arm.name, arm] as const))('%s', (_name, arm) => {
  it('starts with ten crates, an empty stack, no score and a full clock', async () => {
    await withGame(arm, (game) => {
      expect(game.state).toMatchObject({
        score: 0,
        carried: 0,
        timeLeft: 60,
        cratesRemaining: 10,
      });
    });
  });

  it('puts the player at the start position, standing on the floor', async () => {
    await withGame(arm, (game) => {
      const player = playerOf(game.scene);
      expect(player.position.x).toBeCloseTo(0, 5);
      expect(player.position.y).toBeCloseTo(0.8, 5);
      expect(player.position.z).toBeCloseTo(6, 5);
    });
  });

  it('moves at six units a second, with screen-up as −Z', async () => {
    await withGame(arm, (game) => {
      const player = playerOf(game.scene);
      walk(game, 0, 1, 1);
      // One second at 6 u/s, from z = 6, moving away from the camera.
      expect(player.position.z).toBeCloseTo(0, 1);
      expect(player.position.x).toBeCloseTo(0, 5);
    });
  });

  it('clamps a diagonal, so a corner is not faster than a straight line', async () => {
    await withGame(arm, (game) => {
      const player = playerOf(game.scene);
      const from = player.position.clone();
      walk(game, 1, 1, 1);
      expect(from.distanceTo(player.position)).toBeCloseTo(6, 1);
    });
  });

  it('keeps the player inside the walls', async () => {
    await withGame(arm, (game) => {
      const player = playerOf(game.scene);
      walk(game, 1, 0, 10);
      expect(player.position.x).toBeCloseTo(9.5, 5);
    });
  });

  it('picks a crate up by touching it', async () => {
    await withGame(arm, (game) => {
      walkTo(game, -3, 5); // the crate nearest the start
      expect(game.state.carried).toBe(1);
      expect(game.state.cratesRemaining).toBe(9);
      expect(game.state.score).toBe(0);
    });
  });

  it('carries the stack above the player rather than leaving it behind', async () => {
    await withGame(arm, (game) => {
      walkTo(game, -3, 5);
      const player = playerOf(game.scene);
      walk(game, -1, 0, 0.5);

      const carried = game.scene
        .getObjectsByProperty('name', 'crate')
        .filter((node) => node.position.y > 1);
      expect(carried).toHaveLength(1);
      expect(carried[0]!.position.x).toBeCloseTo(player.position.x, 3);
      expect(carried[0]!.position.z).toBeCloseTo(player.position.z, 3);
      expect(carried[0]!.position.y).toBeCloseTo(player.position.y + 0.8 + 0.31, 3);
    });
  });

  it('banks the stack at the depot, and only there', async () => {
    await withGame(arm, (game) => {
      walkTo(game, -3, 5);
      expect(game.state.carried).toBe(1);

      // Still out on the field: nothing is banked yet.
      expect(game.state.score).toBe(0);

      walkTo(game, 0, 0);
      expect(game.state.score).toBe(1);
      expect(game.state.carried).toBe(0);
      expect(game.state.cratesRemaining).toBe(9);
    });
  });

  it('runs the clock down and floors it at zero', async () => {
    await withGame(arm, (game) => {
      run(game, 10);
      expect(game.state.timeLeft).toBeCloseTo(50, 1);
      run(game, 55);
      expect(game.state.timeLeft).toBe(0);
    });
  });

  it('stops collecting once time is up', async () => {
    await withGame(arm, (game) => {
      run(game, 61);
      expect(game.state.timeLeft).toBe(0);
      const before = { ...game.state };
      walkTo(game, -3, 5, 2);
      expect(game.state.carried).toBe(before.carried);
      expect(game.state.cratesRemaining).toBe(before.cratesRemaining);
    });
  });

  it('is deterministic: the same input twice gives the same numbers', async () => {
    const play = async (): Promise<string> => {
      let seen = '';
      await withGame(arm, (game) => {
        walkTo(game, -3, 5);
        walkTo(game, 0, 0);
        seen = JSON.stringify(game.state);
      });
      return seen;
    };
    expect(await play()).toBe(await play());
  });
});

/**
 * The capsule, by name.
 *
 * Names are the contract precisely because everything else is arm-private: a SceNoCo `id`, a
 * React ref and a local variable mean nothing to a test that has to run against all four.
 */
function playerOf(scene: Object3D): Object3D {
  const player = scene.getObjectByName('player');
  if (!player) throw new Error('no object named "player" in this arm\'s scene');
  return player;
}
