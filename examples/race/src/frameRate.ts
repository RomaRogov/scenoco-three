import type { WebGLRenderer } from 'three';

/**
 * Holds the frame rate by drawing less where the device cannot keep up. It starts at the screen's
 * own pixel ratio, up to `max`; while frames average slower than `budget` milliseconds, it steps the
 * ratio down by `step` to `min`, then gives up `extras` one at a time, in order — a game's costliest
 * looks, such as bloom or shadows. It never steps back up, so it settles rather than see-saws.
 * Fill is what a tablet runs out of first: on a Xiaomi Pad 5, 1.5 pixels per CSS pixel instead of
 * 2 is the difference between 54 and 60 fps; a 2 GB Allwinner box needs the extras gone as well.
 */
export function keepFrameRate(
  renderer: WebGLRenderer,
  { min = 1, max = 2, step = 0.25, budget = 19, extras = [] as (() => void)[] } = {},
): void {
  let ratio = Math.min(devicePixelRatio, max);
  renderer.setPixelRatio(ratio);
  const left = [...extras];
  let frames = 0;
  let total = 0;
  let last = performance.now();
  let settle = 1000; // milliseconds to let a change take before measuring again
  const tick = (now: number) => {
    const dt = now - last;
    last = now;
    // A hidden tab, or a pause in the debugger: not a frame the game drew slowly.
    if (dt < 250 && (settle -= dt) <= 0) {
      total += dt;
      frames++;
      // A second of frames, whatever the frame rate, before each decision.
      if (total >= 1000) {
        const average = total / frames;
        if (average > budget) {
          if (ratio > min) {
            ratio = Math.max(min, ratio - step);
            renderer.setPixelRatio(ratio);
            console.info(`pixel ratio: ${ratio} (frames averaged ${average.toFixed(1)} ms)`);
          } else {
            left.shift()?.();
            console.info(`dropped an extra, ${left.length} left (frames averaged ${average.toFixed(1)} ms)`);
          }
          settle = 1000;
        }
        frames = 0;
        total = 0;
      }
    }
    if (ratio > min || left.length > 0) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
