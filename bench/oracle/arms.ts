import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Object3D } from 'three';
import type { CreateGame, Game } from './types.js';

/**
 * Every arm that exists on disk and has been built.
 *
 * Discovered rather than listed, so adding an arm is adding a directory. An arm that has not been
 * installed and built is skipped with a message rather than failing the suite: the four are built
 * one at a time, and a red suite for "you have not run `npm run build:arms` yet" trains people to
 * ignore red suites.
 */
export interface Arm {
  name: string;
  load: () => Promise<{ createGame: CreateGame }>;
}

const ROOT = fileURLToPath(new URL('../arms', import.meta.url));

/** An arm's seam, whichever extension it needed — mounting a React tree means writing JSX. */
function harnessOf(name: string): string | null {
  for (const extension of ['ts', 'tsx']) {
    const path = `${ROOT}/${name}/src/harness.${extension}`;
    if (existsSync(path)) return path;
  }
  return null;
}

export function arms(): Arm[] {
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => harnessOf(name) !== null)
    .filter((name) => existsSync(`${ROOT}/${name}/node_modules`))
    .sort()
    .map((name) => ({
      name,
      load: () => import(harnessOf(name)!) as Promise<{ createGame: CreateGame }>,
    }));
}

/**
 * Run `body` against every built arm, as its own test.
 *
 * One task's assertions, four codebases, no per-arm branches — a test that needs to know which
 * arm it is running against is not measuring the same thing in each.
 */
export async function withGame(arm: Arm, body: (game: Game) => Promise<void> | void): Promise<void> {
  const { createGame } = await arm.load();
  const game: Game = await createGame();
  try {
    await body(game);
  } finally {
    game.dispose();
  }
}

/** Advance `seconds` of game time in fixed 1/60 steps, the way a frame loop would. */
export function run(game: Game, seconds: number): void {
  const dt = 1 / 60;
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += dt) game.step(dt);
}

/** Hold a direction for `seconds`, then stop. */
export function walk(game: Game, x: number, y: number, seconds: number): void {
  game.input.move(x, y);
  run(game, seconds);
  game.input.move(0, 0);
}

/**
 * Walk toward a point on the ground, re-aiming every frame, until it is reached or time is up.
 *
 * The axis mapping lives here and nowhere else. `move(x, y)` is a stick: screen-up is world −Z,
 * so steering toward +Z means pushing the stick *down*. Writing that out at each call site is how
 * a test ends up asserting the wrong thing about a game that is behaving correctly.
 */
export function walkTo(game: Game, x: number, z: number, seconds = 5): void {
  const player = game.scene.getObjectByName('player');
  if (!player) throw new Error('no object named "player" in this arm\'s scene');

  const dt = 1 / 60;
  for (let elapsed = 0; elapsed < seconds; elapsed += dt) {
    const dx = x - player.position.x;
    const dz = z - player.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.05) break;
    game.input.move(dx / distance, -dz / distance);
    game.step(dt);
  }
  game.input.move(0, 0);
}

/** One node by its normative name. Throws rather than returning null: a missing name is a bug. */
export function named(game: Game, name: string): Object3D {
  const node = game.scene.getObjectByName(name);
  if (!node) throw new Error(`no object named "${name}" in this arm's scene`);
  return node;
}

/** Every node with a normative name. */
export function allNamed(game: Game, name: string): Object3D[] {
  return game.scene.getObjectsByProperty('name', name);
}

/** How far the player travels in `seconds` at full stick, for measuring a speed change. */
export function speedOver(game: Game, seconds: number): number {
  const player = named(game, 'player');
  const from = player.position.clone();
  walk(game, 1, 0, seconds);
  return from.distanceTo(player.position) / seconds;
}
