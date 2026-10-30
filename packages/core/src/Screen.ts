// With no window — a test under `simulate` — a common screen, so sizes worked out from it stay sane.
const size = {
  width: (globalThis as { innerWidth?: number }).innerWidth ?? 1920,
  height: (globalThis as { innerHeight?: number }).innerHeight ?? 1080,
};

/**
 * Unity's `Screen`: the size the game is drawn at, in CSS pixels — the same units as
 * `Input.mousePosition`. It changes only when the canvas does, so reading it every frame costs
 * nothing, where `innerHeight` read after the page's text changed has the browser lay the page out
 * again just to answer.
 */
export const Screen = {
  get width(): number {
    return size.width;
  },
  get height(): number {
    return size.height;
  },
};

/** @internal The canvas's new size: `play` says it when the canvas is resized. */
export function setScreenSize(width: number, height: number): void {
  size.width = width;
  size.height = height;
}
