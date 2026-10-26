/**
 * The running game, from a test: hold its clock, step exact frames, wait for a condition, read its
 * behaviours — through the bridge `play()` installs in development, on any page a harness already
 * has open.
 *
 * ```ts
 * import { test, expect } from '@playwright/test';
 * import { observe } from '@scenoco-three/observer';
 *
 * test('the first brick breaks', async ({ page }) => {
 *   await page.goto('http://localhost:5173');
 *   const game = await observe(page);
 *   await game.press('Space');
 *   expect((await game.until('GameState.bricksLeft < 19', { maxFrames: 1200 })).met).toBe(true);
 *   expect(await game.eval('return Progress.score')).toBeGreaterThan(0);
 * });
 * ```
 *
 * Each method is one call into `window.__scenoco` — the same calls an agent makes with its browser
 * tool's evaluate, so a test and an agent see the same game. It needs nothing from the
 * harness but `evaluate`: Playwright's page, Puppeteer's. Nothing here launches a browser.
 */

/** What `observe` uses of a page. Playwright's and Puppeteer's pages have it. */
export interface PageLike {
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
}

export interface Clock {
  held: boolean;
  time: number;
  frame: number;
  timeScale: number;
}

export interface Until extends Clock {
  /** The condition came true, after `frames` frames. */
  met: boolean;
  frames: number;
}

/** One sample of `watch`: the time, the frame, and each expression's value under its own text. */
export type WatchRow = { t: number; frame: number } & Record<string, unknown>;

export interface Viewpoint {
  cameraPos: [number, number, number];
  /** A point, or a node by name: `"#player"`. The origin when left out. */
  lookAt?: [number, number, number] | string;
  fov?: number;
}

export interface Steps {
  /** Seconds per frame: 1/60 when left out. */
  dt?: number;
}

export interface Observed {
  clock(): Promise<Clock>;
  /** Hold the clock where it is: the game moves only when stepped. */
  pause(): Promise<Clock>;
  /** Let the game run in real time again. */
  play(): Promise<Clock>;
  /** Hold the clock and advance exactly `frames` frames. */
  step(frames?: number, options?: Steps): Promise<Clock>;
  /** Hold the clock and step until `code` is true — `"GameState.phase === 'over'"` — or `maxFrames` pass. */
  until(code: string, options?: Steps & { maxFrames?: number }): Promise<Until>;
  /** Hold the clock, step `frames`, and read each expression every `every` frames. */
  watch(fields: string[], options?: Steps & { frames?: number; every?: number }): Promise<WatchRow[]>;
  /**
   * Run the body of an async function in the game; its `return` comes back as JSON. In scope: every
   * behaviour class by name (`Player.lane` is the first live one's), `find`, `findAll`, `node('name')`
   * or `#name`, `destroy`, `scene`, `camera`, `Time`, `Input`, `SceneManager`, `THREE`.
   */
  eval<T = unknown>(code: string): Promise<T>;
  /** The scene as text: named nodes and nodes with behaviours, with each behaviour's fields. */
  outline(depth?: number): Promise<string>;
  /** `"Player"` — every live Player's fields; `"Player.lane"` — that value of each; `"#name"` — a node. */
  telemetry(target: string): Promise<unknown>;
  /** Draw from another viewpoint, holding the clock, until `view(null)` or `play()`; take the page's screenshot. */
  view(viewpoint: Viewpoint | null): Promise<Clock>;
  /** Press a key for `frames` frames — stepped when the clock is held: `"Space"`, `"ArrowLeft"`, `"a"`. */
  press(key: string, frames?: number): Promise<void>;
  keyDown(key: string): Promise<void>;
  keyUp(key: string): Promise<void>;
  /** Click or tap at a point of the window, in pixels from its top-left, then let a frame pass. */
  click(x: number, y: number): Promise<void>;
  pointerDown(x: number, y: number): Promise<void>;
  pointerMove(x: number, y: number): Promise<void>;
  pointerUp(): Promise<void>;
  /** Press, drag over `frames` frames, and lift: a swipe. */
  swipe(from: [number, number], to: [number, number], frames?: number): Promise<void>;
}

/**
 * The game on `page`, once its bridge is there and it has run a few frames — behaviours attach their
 * input listeners on their first frames, so a key pressed sooner goes nowhere.
 */
export async function observe(page: PageLike, options: { timeout?: number } = {}): Promise<Observed> {
  const timeout = options.timeout ?? 15_000;
  const ready = await page.evaluate(
    (limit) =>
      new Promise<boolean>((done) => {
        const start = Date.now();
        const look = () => {
          const bridge = (window as unknown as { __scenoco?: { clock(): { frame: number } } }).__scenoco;
          if (bridge && bridge.clock().frame >= 3) return done(true);
          if (Date.now() - start > limit) return done(false);
          setTimeout(look, 50);
        };
        look();
      }),
    timeout,
  );
  if (!ready) {
    throw new Error(
      `observe: no SceNoCo game on this page within ${timeout} ms. The bridge is window.__scenoco, installed by ` +
        'play() when Vite serves the page in development — a production build has none.',
    );
  }

  const call = async <T>(method: string, ...args: unknown[]): Promise<T> => {
    try {
      return await page.evaluate(
        async ([m, a]) => {
          const bridge = (window as unknown as { __scenoco: Record<string, (...x: unknown[]) => unknown> }).__scenoco;
          return (await bridge[m]!(...a)) as T;
        },
        [method, args] as [string, unknown[]],
      );
    } catch (error) {
      // The game's own message, without the harness's wrapper or the bridge's stack.
      const text = (error instanceof Error ? error.message : String(error)).replace(/^\w+\.evaluate: (Error: )?/, '');
      throw new Error(text.split('\n    at ')[0]);
    }
  };

  const dt = (options?: Steps) => options?.dt ?? 1 / 60;
  return {
    clock: () => call<Clock>('clock'),
    pause: () => call<Clock>('pause'),
    play: () => call<Clock>('play'),
    step: (frames = 1, options) => call<Clock>('step', frames, dt(options)),
    until: (code, options) => call<Until>('until', code, options?.maxFrames ?? 600, dt(options)),
    watch: (fields, options) => call<WatchRow[]>('watch', fields, options?.frames ?? 60, options?.every ?? 10, dt(options)),
    eval: <T>(code: string) => call<T>('eval', code),
    outline: (depth = 4) => call<string>('outline', depth),
    telemetry: (target) => call('telemetry', target),
    view: (viewpoint) => call<Clock>('view', viewpoint),
    press: (key, frames = 6) => call('press', key, frames),
    keyDown: (key) => call('keyDown', key),
    keyUp: (key) => call('keyUp', key),
    click: (x, y) => call('click', x, y),
    pointerDown: (x, y) => call('pointerDown', x, y),
    pointerMove: (x, y) => call('pointerMove', x, y),
    pointerUp: () => call('pointerUp'),
    swipe: (from, to, frames = 8) => call('swipe', from, to, frames),
  };
}
