import { advance } from '@react-three/fiber';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { Scene } from 'three';
import { Yard } from './Yard.js';
import { createYard, DURATION } from './store.js';

/**
 * The benchmark seam. Declared locally rather than imported — this is a standalone project — and
 * checked structurally where the oracle assigns it. See `bench/PARITY.md`.
 */
export interface GameState {
  score: number;
  carried: number;
  timeLeft: number;
  cratesRemaining: number;
}

export interface Game {
  scene: Scene;
  state: GameState;
  input: { move(x: number, y: number): void };
  step(dt: number): void;
  dispose(): void;
}

/**
 * Mount the tree with no WebGL, driven a frame at a time.
 *
 * `@react-three/test-renderer` is the sanctioned way to run an R3F tree in Node — it is what an
 * R3F project's own tests use — and `frameloop: 'never'` hands the clock over: `advance` runs one
 * frame synchronously, so this arm's `step` is the same shape as every other arm's rather than
 * an async outlier the oracle has to special-case.
 *
 * A delivery calls `setState`, and the unmount it schedules lands on React's own timetable rather
 * than inside this call. That is deliberate and it changes no number the oracle reads: a crate
 * leaves `loose` when it is picked up, not when it is banked, so the counts are already right —
 * what arrives late is only the mesh disappearing from the scene.
 */
export async function createGame(): Promise<Game> {
  const yard = createYard();
  const renderer = await ReactThreeTestRenderer.create(<Yard state={yard} />, {
    frameloop: 'never',
  });

  const scene = (renderer.scene as unknown as { instance: Scene }).instance;
  let now = 0;

  return {
    scene,
    // Getters, so the oracle reads live numbers rather than a snapshot taken at build time.
    get state() {
      return {
        get score() {
          return yard.score;
        },
        get carried() {
          return yard.stack.length;
        },
        get timeLeft() {
          return yard.timeLeft;
        },
        get cratesRemaining() {
          return yard.loose.length;
        },
      };
    },
    input: {
      move(x, y) {
        yard.move.set(x, y);
      },
    },
    step(dt) {
      // Seconds, not milliseconds: in `frameloop: 'never'` R3F takes the frame delta as
      // `timestamp - clock.elapsedTime`, so the timestamp is on the same scale as the delta
      // `useFrame` receives. Passing ms here runs the game a thousand times too fast.
      now += dt;
      advance(now);
    },
    dispose() {
      void renderer.unmount();
    },
  };
}

export { DURATION };
