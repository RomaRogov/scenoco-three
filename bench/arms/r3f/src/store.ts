import { Vector2, type Object3D } from 'three';

/** Crate positions, as `(x, z)`. Fixed: nothing in this game is random. */
export const CRATES: ReadonlyArray<readonly [number, number]> = [
  [-6, -6],
  [-3, 5],
  [2, 7],
  [6, 3],
  [7, -4],
  [-7, 2],
  [4, -7],
  [-2, -8],
  [8, 6],
  [-8, -2],
];

export const SPEED = 6;
export const BOUNDS = 9.5;
export const PICKUP_RADIUS = 1;
export const DEPOT_RADIUS = 2;
export const STACK_SPACING = 0.62;
export const STACK_LIFT = 0.31;
export const DURATION = 60;

/**
 * The game's mutable state, deliberately outside React.
 *
 * A position that changes sixty times a second is not component state: putting it in `useState`
 * re-renders the tree every frame to move a mesh React is not drawing anyway. The R3F convention
 * is to mutate refs inside `useFrame` and keep only what the UI reads in a store — and here even
 * the counters are read by a test harness rather than rendered, so all of it lives here.
 */
export interface Yard {
  player: Object3D | null;
  /** Crates still lying in the arena. */
  loose: Object3D[];
  /** Crates on the player's back, bottom first. */
  stack: Object3D[];
  readonly move: Vector2;
  timeLeft: number;
  score: number;
}

export function createYard(): Yard {
  return {
    player: null,
    loose: [],
    stack: [],
    move: new Vector2(),
    timeLeft: DURATION,
    score: 0,
  };
}
