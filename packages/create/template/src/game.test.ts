import { afterEach, expect, it } from 'vitest';
import { KeyCode, findObjectOfType, findObjectsOfType, simulate, type Simulation } from '@scenoco-three/core';
import page from '../index.html?raw';
import { Fade } from './Fade';
import { Mover } from './Mover';
import { Main } from './scenes/Main';

// The game's rules, with no canvas: the scene is built, and frames pass only when the test steps them.
// A physics game starts its engine first: beforeAll(() => initRapier()).
let game: Simulation;
afterEach(() => game.dispose());

it('moves the player right while the right arrow is held', () => {
  game = simulate(Main, { page });
  const player = findObjectOfType(Mover)!.node;
  game.press(KeyCode.RightArrow, 30);
  expect(player.position.x).toBeGreaterThan(1);
});

it('drops a crate on Space, and the crate fades away', () => {
  game = simulate(Main, { page });
  game.press(KeyCode.Space);
  expect(findObjectsOfType(Fade)).toHaveLength(1);
  expect(game.until(() => findObjectsOfType(Fade).length === 0, 300)).toBe(true);
});
