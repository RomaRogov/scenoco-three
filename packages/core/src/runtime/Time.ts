/**
 * Global clock, mirroring Unity's `Time`. Owned and advanced by `SceneManager.tick`.
 * Every value is in seconds.
 */
class TimeClass {
  /** Scaled time elapsed since the first tick. */
  time = 0;
  /** Real time elapsed since the first tick, ignoring `timeScale`. */
  unscaledTime = 0;
  /** Scaled duration of the current frame. */
  deltaTime = 0;
  /** Real duration of the current frame. */
  unscaledDeltaTime = 0;
  /** Length of one fixed step. `fixedUpdate` always sees exactly this value. */
  fixedDeltaTime = 1 / 50;
  /** Scaled time consumed by fixed steps so far. */
  fixedTime = 0;
  /**
   * How far the current frame sits into the next fixed step, in `[0, 1)`. Anything moving at
   * the fixed rate blends its last two poses with this, so motion stays smooth.
   */
  interpolationAlpha = 0;
  /** Speed multiplier for `deltaTime` / `fixedUpdate` frequency. `0` freezes gameplay. */
  timeScale = 1;
  /** Frames rendered since start. */
  frameCount = 0;
  /** Upper bound for one frame's unscaled delta, so a backgrounded tab cannot spiral. */
  maximumDeltaTime = 1 / 6;

  /** @internal advanced by the SceneManager */
  advance(unscaledDelta: number): void {
    const clamped = Math.min(unscaledDelta, this.maximumDeltaTime);
    this.unscaledDeltaTime = clamped;
    this.deltaTime = clamped * this.timeScale;
    this.unscaledTime += clamped;
    this.time += this.deltaTime;
    this.frameCount++;
  }

  /** @internal called once per fixed step */
  advanceFixed(): void {
    this.fixedTime += this.fixedDeltaTime;
  }

  /** @internal */
  reset(): void {
    this.time = 0;
    this.unscaledTime = 0;
    this.deltaTime = 0;
    this.unscaledDeltaTime = 0;
    this.fixedTime = 0;
    this.interpolationAlpha = 0;
    this.frameCount = 0;
  }
}

export const Time = new TimeClass();
export type { TimeClass };
