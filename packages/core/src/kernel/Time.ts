import { Runtime } from './runtime.js';

/**
 * Unity's `Time`: the running scene's clock.
 *
 * `Time.timeScale = 0` pauses the game — `update` and `lateUpdate` still run, with `deltaTime` 0,
 * so a pause menu keeps working; `fixedUpdate`, physics and `WaitForSeconds` stop. 0.5 is slow
 * motion. Real-time values are the `unscaled` ones.
 */
export const Time = {
  /** Seconds this frame took, scaled — and `fixedDeltaTime` inside `fixedUpdate`, as in Unity. */
  get deltaTime(): number {
    return clock()?.deltaTime ?? 0;
  },
  /** Seconds this frame took in real time, whatever `timeScale` is. */
  get unscaledDeltaTime(): number {
    return clock()?.unscaledDeltaTime ?? 0;
  },
  /** Game seconds since the scene started, at the start of this frame. */
  get time(): number {
    return clock()?.time ?? 0;
  },
  /** Real seconds since the scene started. */
  get unscaledTime(): number {
    return clock()?.unscaledTime ?? 0;
  },
  /** How fast game time runs: 1 normal, 0 paused, 0.5 slow motion. */
  get timeScale(): number {
    return clock()?.timeScale ?? 1;
  },
  set timeScale(value: number) {
    const runtime = clock();
    if (!runtime) throw new Error('Time.timeScale needs a running scene — set it from a behaviour.');
    if (!(value >= 0)) throw new Error(`Time.timeScale must be 0 or more, not ${value}.`);
    runtime.timeScale = value;
  },
  /** Seconds between `fixedUpdate`s. */
  get fixedDeltaTime(): number {
    return clock()?.fixedDelta ?? 0.02;
  },
  /** Frames since the scene started. */
  get frameCount(): number {
    return clock()?.frame ?? 0;
  },
};

function clock(): Runtime | null {
  return Runtime.current;
}
