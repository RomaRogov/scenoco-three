import { expect } from 'vitest';
import { Color, type Mesh } from 'three';
import { named, walkTo } from '../arms.js';
import type { Game } from '../types.js';

/**
 * Red at three crates or more, blue below.
 *
 * Read off the material rather than a screenshot: the oracle is arm-neutral and pixel-free, and
 * "is this mesh red" is a property of the scene graph. Whether it *looks* right is what the eyes
 * are for, and that is judged separately.
 */
export function check(game: Game): void {
  const player = named(game, 'player') as Mesh;

  expect(isRed(player), 'the player is red before carrying anything').toBe(false);

  const route: ReadonlyArray<readonly [number, number]> = [
    [-3, 5],
    [2, 7],
    [6, 3],
  ];
  for (const [x, z] of route) walkTo(game, x, z);
  expect(game.state.carried).toBe(3);
  expect(isRed(player), 'the player did not turn red at three crates').toBe(true);

  walkTo(game, 0, 0);
  expect(game.state.carried).toBe(0);
  expect(isRed(player), 'the player stayed red after delivering').toBe(false);
}

/** Red enough: dominant red channel, and not merely a lighter blue. */
function isRed(mesh: Mesh): boolean {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const colour = (material as { color?: Color }).color;
  if (!colour) return false;
  return colour.r > 0.4 && colour.r > colour.b * 1.5 && colour.r > colour.g * 1.5;
}
