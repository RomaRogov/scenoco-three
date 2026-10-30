/**
 * Dev only: the bridge a test or an agent drives the running game through, at `window.__scenoco`.
 *
 * `play()` installs it when Vite serves the page in development. It holds the clock — the page's
 * loop stops calling `runtime.update` — and steps exact frames, so a reading or a screenshot lands on
 * the frame it names. It reads game state by behaviour class and node name: nothing in the game has
 * to expose anything. Every method takes and returns plain data, so any harness that can evaluate
 * JavaScript in the page can call it — Playwright's `page.evaluate`, Puppeteer's, a console.
 */
import * as THREE from 'three';
import { Behaviour, Runtime, Time } from '../kernel/index.js';
import { isHeld, setHeld, setView } from '../host.js';
import { runDrive, type DriveScope } from './drive.js';
import { createInput } from './input.js';
import { fields, outline, plain, round, telemetry } from './read.js';
import { createScope, type ObservedState } from './scope.js';

export type { ObservedState } from './scope.js';

/** A frame of the held clock: what `step` advances by when not told otherwise. */
export const DT = 1 / 60;

/** @internal Put `window.__scenoco` on the page, driving `runtime`; what it returns takes it off again. */
export function installBridge(
  runtime: Runtime,
  get: () => ObservedState,
  /** One frame of the game, as the page's own loop runs it. */
  frame: (dt: number) => void = (dt) => runtime.update(dt),
): () => void {
  const restoreTimers = warnAboutTimers(runtime);
  const reading = createScope(get);
  const { learnClasses, byClass, nodeNamed, of, expression } = reading;

  /**
   * Let the page draw what was stepped, so a screenshot taken next shows it. A hidden page never
   * paints, so this does not wait for longer than a tenth of a second.
   */
  const nextPaint = (): Promise<void> =>
    new Promise((done) => {
      setTimeout(done, 100);
      requestAnimationFrame(() => requestAnimationFrame(() => done()));
    });

  const stepFrames = (frames: number, dt: number): void => {
    for (let i = 0; i < frames; i++) frame(dt);
  };
  /** Let frames pass: stepped when the clock is held, in real time otherwise. */
  const pass = async (frames: number): Promise<void> => {
    if (isHeld(runtime)) stepFrames(frames, DT);
    await new Promise((done) => setTimeout(done, isHeld(runtime) ? 0 : (frames * 1000) / 60));
    await nextPaint();
  };
  const hold = () => setHeld(runtime, true);

  const bridge = {
    /** What this is and how to call it — the first thing to read. */
    help(): string {
      return HELP;
    },
    clock() {
      return { held: isHeld(runtime), time: round(Time.time), frame: Time.frameCount, timeScale: Time.timeScale };
    },
    /**
     * Once the game has run its first frames. Behaviours start listening for input on their first
     * frames, so a key pressed sooner goes nowhere: call this before anything else.
     */
    async ready(frames = 3) {
      while (runtime.frame < frames) {
        if (isHeld(runtime)) stepFrames(frames - runtime.frame, DT);
        else await new Promise((done) => requestAnimationFrame(done));
      }
      return bridge.clock();
    },
    /** Hold the clock where it is: the game moves only when stepped. */
    pause() {
      hold();
      return bridge.clock();
    },
    /** Run in real time again, from the game camera. */
    play() {
      setHeld(runtime, false);
      setView(runtime, null);
      return bridge.clock();
    },
    /** Hold the clock and advance exactly `frames` frames of `dt` seconds. */
    async step(frames = 1, dt = DT) {
      hold();
      stepFrames(frames, dt);
      await nextPaint();
      return bridge.clock();
    },
    /** Hold the clock and step until `code` is true, at most `maxFrames`. */
    async until(code: string | (() => unknown), maxFrames = 600, dt = DT) {
      hold();
      const test = typeof code === 'string' ? expression(code) : code;
      for (let frame = 0; frame <= maxFrames; frame++) {
        if (test()) {
          await nextPaint();
          return { met: true, frames: frame, ...bridge.clock() };
        }
        if (frame < maxFrames) stepFrames(1, dt);
      }
      await nextPaint();
      return { met: false, frames: maxFrames, ...bridge.clock() };
    },
    /**
     * Hold the clock, step `frames`, and read each expression every `every` frames: one row per
     * sample, with the time, the frame and each value under its text. A reading that throws is `{ error }`.
     */
    async watch(fields: string[], frames = 60, every = 10, dt = DT, compile: (field: string) => () => unknown = expression) {
      hold();
      const readers = fields.map((field) => ({ field, read: compile(field) }));
      const rows: Record<string, unknown>[] = [];
      const sample = () => {
        const row: Record<string, unknown> = { t: round(Time.time), frame: Time.frameCount };
        for (const { field, read } of readers) {
          try {
            row[field] = plain(read(), 1);
          } catch (error) {
            row[field] = { error: (error as Error).message };
          }
        }
        rows.push(row);
      };
      sample();
      for (let done = 0; done < frames; ) {
        const n = Math.min(every, frames - done);
        stepFrames(n, dt);
        done += n;
        sample();
      }
      await nextPaint();
      return rows;
    },
    /** The body of an async function, with the game's names in scope; what it returns, as JSON. */
    async eval(code: string): Promise<unknown> {
      const value = await reading.run(code);
      await nextPaint();
      // A behaviour returned whole reads as telemetry does: its fields and getters.
      if (value instanceof Behaviour) return { class: value.constructor.name, ...fields(value) };
      return plain(value, 3);
    },
    /** The first live behaviour of a class, by name — the object itself, to read or change. */
    find(type: string): Behaviour | null {
      return (reading.scope().find as (t: string) => Behaviour | null)(type);
    },
    findAll(type: string): Behaviour[] {
      return (reading.scope().findAll as (t: string) => Behaviour[])(type);
    },
    /** A node by the name it was given in the scene. */
    node(name: string): THREE.Object3D | null {
      return get().scene.getObjectByName(name) ?? null;
    },
    outline(depth = 4): string {
      const c = bridge.clock();
      return `time ${c.time}s · frame ${c.frame} · timeScale ${c.timeScale}${c.held ? ' · clock held' : ''}\n${outline(get().scene, depth).join('\n')}`;
    },
    /** `Player` — every live Player; `Player.lane` — that field of each; `#runner` — a node by name. */
    telemetry(target: string): unknown {
      return telemetry(target, reading);
    },
    /**
     * Draw the scene from another viewpoint, holding the clock, until `view(null)` or `play()`: the
     * next screenshot of the page shows it, HUD and all.
     */
    async view(options: { cameraPos: number[]; lookAt?: number[] | string; fov?: number } | null) {
      if (!options) {
        setView(runtime, null);
      } else {
        const { camera, size } = get();
        const eye = new THREE.PerspectiveCamera(options.fov ?? (camera as THREE.PerspectiveCamera | null)?.fov ?? 50, size.width / size.height, 0.05, 2000);
        eye.position.fromArray(options.cameraPos);
        const target =
          typeof options.lookAt === 'string'
            ? nodeNamed(options.lookAt.replace(/^#/, '')).getWorldPosition(new THREE.Vector3())
            : new THREE.Vector3().fromArray(options.lookAt ?? [0, 0, 0]);
        eye.lookAt(target);
        hold();
        setView(runtime, eye);
      }
      await nextPaint();
      return bridge.clock();
    },
    ...createInput(pass),
  };

  (window as unknown as { __scenoco?: unknown }).__scenoco = bridge;
  const script = new URLSearchParams(location.search).get('drive');
  if (script) {
    const camera = () => get().camera;
    const scope: DriveScope = {
      type: (name) => learnClasses().get(name),
      live: (name) => byClass().get(name) ?? [],
      of,
      node: nodeNamed,
      globals: { Time, get scene() { return get().scene; }, get camera() { return camera(); } },
    };
    void runDrive(bridge as unknown as Record<string, (...args: unknown[]) => unknown>, script, scope);
  }
  // Where an agent's browser tools look first: the console says what drives the game.
  console.info(
    'SceNoCo: this game is driven from the page with window.__scenoco — call __scenoco.help(). ' +
      "A tool that cannot run JavaScript in the page drives it from the address and reads the console: ?drive=press('Space');until(Game.over);outline()",
  );
  return () => {
    setHeld(runtime, false);
    setView(runtime, null);
    restoreTimers();
    const w = window as unknown as { __scenoco?: unknown };
    if (w.__scenoco === bridge) delete w.__scenoco;
  };
}

const HELP = `window.__scenoco — the running SceNoCo game, from the page (development only).
Every method returns plain data; await the async ones. From Playwright: page.evaluate(() => __scenoco.until("Game.over")).

Clock — a held clock moves only when stepped, so every reading lands on an exact frame:
  pause()  play()  clock()
  step(frames = 1)                      advance exactly this many frames
  until(code, maxFrames = 600)          step until code is true: until("GameState.phase === 'over'")
  watch([code, …], frames = 60, every = 10)   rows of values over time: watch(["Player.lane", "Time.time"])
Reading — code is JavaScript where Player.lane is the first live Player's lane, #runner the node named "runner",
and find(Type) / findAll(Type) / node(name) / getComponent(node, Type) and its kin / destroy / scene / camera / Time /
Input / SceneManager / THREE are in scope:
  eval(code)                            the body of an async function: eval("return findAll(Coin).length")
  find(Type)  findAll(Type)  node(name) the live objects themselves, to read or change
  outline(depth = 4)                    the scene as text, with every behaviour's fields
  telemetry("Player" | "Player.lane" | "#name")
Input — as the player's, stepped while the clock is held; x, y in pixels from the window's top-left:
  press(key, frames = 6)  keyDown(key)  keyUp(key)      keys: "Space", "ArrowLeft", "a", "Enter", "Escape"
  click(x, y)  pointerDown(x, y)  pointerMove(x, y)  pointerUp()  swipe([x, y], [x, y], frames = 8)
Looking — take the screenshot with the browser's own tool:
  view({ cameraPos: [x, y, z], lookAt: [x, y, z] | "#name", fov }) draws from there until view(null) or play()
CSS animations and timers in the page run in real time, not on the held clock: to wait for one, play() and let it finish.
Start with ready(): it resolves once the game has run its first frames — a key pressed sooner goes nowhere.
Driving from the address, for a tool that cannot run JavaScript here: ?drive=press('Space');until(Game.over);read(count(Brick))
runs the calls in order on a held clock, one console line each, and holds the last frame for a screenshot; write # as %23.
It reads data, not code: fields and getters of behaviours, #nodes, Time, count/find/findAll(Type), operators — no other calls.`;

/**
 * A timer started from inside a frame is game code timing itself outside the game clock: it keeps
 * counting at `Time.timeScale = 0` and while the bridge steps frames. Say so once, with the fix.
 */
function warnAboutTimers(runtime: Runtime): () => void {
  const w = window as unknown as Record<'setTimeout' | 'setInterval', (...args: unknown[]) => unknown>;
  const originals = { setTimeout: w.setTimeout, setInterval: w.setInterval };
  const warned = new Set<string>();
  for (const name of ['setTimeout', 'setInterval'] as const) {
    const original = originals[name];
    w[name] = function (this: unknown, ...args: unknown[]) {
      if (runtime.updating && !warned.has(name)) {
        warned.add(name);
        console.warn(
          `${name} was called from a behaviour. It keeps counting while Time.timeScale is 0 and while the game is ` +
            'stepped frame by frame. Time it with a coroutine instead: this.startCoroutine(this.later()) and ' +
            '`yield new WaitForSeconds(s)` inside — or count Time.deltaTime in update().',
        );
      }
      return original.apply(this, args);
    };
  }
  return () => Object.assign(w, originals);
}
