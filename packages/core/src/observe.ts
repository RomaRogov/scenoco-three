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
import { Behaviour, Event, Runtime, Time, behavioursOn, destroy } from './kernel/index.js';
import { Input } from './input/Input.js';
import { SceneManager } from './scenes.js';
import { parseDrive, reader, source, value, type DriveCall, type DriveScope } from './drive.js';

/** What the bridge reads from whatever draws the frame. */
export interface ObservedState {
  scene: THREE.Scene;
  camera: THREE.Camera | null;
  gl: THREE.WebGLRenderer;
  size: { width: number; height: number };
}

const held = new WeakSet<Runtime>();
/** A viewpoint `view` set, drawn instead of the game camera while it lasts. */
const viewing = new WeakMap<Runtime, THREE.Camera>();
const DT = 1 / 60;

/** @internal true while the bridge holds this runtime's clock. */
export function isHeld(runtime: Runtime): boolean {
  return held.has(runtime);
}

/** @internal the camera the bridge asked to draw from, if any. */
export function viewOf(runtime: Runtime): THREE.Camera | null {
  return viewing.get(runtime) ?? null;
}

/** @internal hold the clock, or let it run — what the bridge's `pause` and `play` do, for the editor. */
export function setHeld(runtime: Runtime, hold: boolean): void {
  if (hold) held.add(runtime);
  else held.delete(runtime);
}

/** @internal draw from `camera` instead of the game's, or from the game's again with null. */
export function setView(runtime: Runtime, camera: THREE.Camera | null): void {
  if (camera) viewing.set(runtime, camera);
  else viewing.delete(runtime);
}

/** @internal */
export function installObserverBridge(
  runtime: Runtime,
  get: () => ObservedState,
  /** One frame of the game, as the page's own loop runs it. */
  frame: (dt: number) => void = (dt) => runtime.update(dt),
): () => void {
  const restoreTimers = warnAboutTimers(runtime);

  /**
   * Every behaviour class the game has — in the scene or only in a prefab — by name. A name stays
   * known once seen, so `findAll(Hazard)` is an empty list before the first hazard spawns, not a
   * ReferenceError.
   */
  const classes = new Map<string, abstract new () => Behaviour>();
  const learnClasses = (): Map<string, abstract new () => Behaviour> => {
    const learn = (node: THREE.Object3D) =>
      node.traverse((n) => {
        for (const b of behavioursOn(n)) classes.set(b.constructor.name, b.constructor as abstract new () => Behaviour);
      });
    learn(get().scene);
    return classes;
  };

  /** Every live behaviour in the running scene, by class name. */
  const byClass = (): Map<string, Behaviour[]> => {
    const out = new Map<string, Behaviour[]>();
    get().scene.traverse((node) => {
      for (const b of behavioursOn(node)) {
        if (b.isDestroyed || b._pendingDestroy) continue;
        const name = b.constructor.name;
        out.set(name, [...(out.get(name) ?? []), b]);
      }
    });
    return out;
  };

  const nodeNamed = (name: string): THREE.Object3D => {
    const found = get().scene.getObjectByName(name);
    if (!found) {
      const names = new Set<string>();
      get().scene.traverse((n) => void (n.name && names.add(n.name)));
      const known = [...names].sort().slice(0, 20).map((n) => `#${n}`).join(', ') || 'none — no node has a name yet';
      throw new Error(`no node named "${name}". Named nodes: ${known}. Name one in the scene: <Group name="${name}">`);
    }
    return found;
  };

  /** Class names searched for in this call that no object has ever had — the likely typo, if it fails. */
  const unseen = new Set<string>();

  /** What eval, until and watch can name. `find` and `findAll` look again on every call. */
  const scope = (): Record<string, unknown> => {
    unseen.clear();
    const pick = (type: string | (abstract new () => Behaviour)) => {
      if (typeof type === 'string' && !learnClasses().has(type)) unseen.add(type);
      const live = byClass();
      return typeof type === 'string' ? (live.get(type) ?? []) : [...live.values()].flat().filter((b) => b instanceof type);
    };
    const out: Record<string, unknown> = {
      scene: get().scene,
      camera: get().camera,
      Time,
      Input,
      SceneManager,
      THREE,
      // `node()` answers as three's getObjectByName does — nothing there is null, so `node('x')?.position`
      // works; the `#x` shorthand insists, because there a missing node is almost always a typo.
      node: (name: string) => get().scene.getObjectByName(name) ?? null,
      __node: nodeNamed,
      __of: of,
      find: (type: string | (abstract new () => Behaviour)) => pick(type)[0] ?? null,
      findAll: pick,
      // The game's own names for the same lookups, so what a model writes in a behaviour works here too.
      findObjectOfType: (type: string | (abstract new () => Behaviour)) => pick(type)[0] ?? null,
      findObjectsOfType: pick,
      destroy,
    };
    for (const [name, type] of learnClasses()) out[name] = type;
    return out;
  };

  /**
   * The same reading everywhere — `until`, `watch` and `eval`: `Player.lane` is the first live
   * Player's lane, the shape a model writes without thinking, and `#runner.position` is the node
   * named "runner". A name the instance does not have is the class's own: `Player.instance` reads
   * the static. A class is still a class where it is not followed by a dot: `findAll(Coin)`.
   */
  const rewrite = (code: string): string => {
    let body = code.replace(/(^|[^\w'"`])#([A-Za-z_][\w-]*)/g, (_, before: string, name: string) => `${before}__node(${JSON.stringify(name)})`);
    // A class no live object has shown yet — only in a prefab that has not been built — is still a
    // fine thing to search for: `findAll(Magnet)` is `findAll("Magnet")`, an empty list until one exists.
    const known = learnClasses();
    body = body.replace(/\b(find|findAll|findObjectOfType|findObjectsOfType)\(\s*([A-Z]\w*)\s*\)/g, (call, fn: string, name: string) =>
      known.has(name) ? call : `${fn}(${JSON.stringify(name)})`,
    );
    for (const name of known.keys()) {
      body = body.replace(new RegExp(`\\b${name}\\b\\s*\\.\\s*([A-Za-z_$][\\w$]*)`, 'g'), (_, member: string) => `__of(${JSON.stringify(name)}, ${JSON.stringify(member)}).${member}`);
    }
    return body;
  };

  /** `Player.member`: the first live Player's, unless only the class has it — a static. */
  const of = (name: string, member: string): unknown => {
    const type = learnClasses().get(name)!;
    const live = byClass().get(name)?.[0] ?? null;
    if (live && member in live) return live;
    if (member in type) return type;
    if (!live) throw new Error(`no ${name} is alive now, and the class has no static "${member}" — findAll(${name}).length is 0 until one is built.`);
    return live;
  };

  /** A name that is not there, answered with the names that are. */
  const explain = (error: unknown): Error => {
    const message = error instanceof Error ? error.message : String(error);
    const missing = /^(\w+) is not defined$/.exec(message)?.[1];
    const known = [...learnClasses().keys()].sort().join(', ') || 'none yet';
    if (!missing) {
      // `find('Game')` is null when no class is called Game, and the error comes later, from reading it.
      if (!unseen.size) return error instanceof Error ? error : new Error(message);
      const names = [...unseen].map((n) => `'${n}'`).join(', ');
      return new Error(`${message} — no object of class ${names} has existed yet. This game's behaviour classes so far: ${known}.`);
    }
    return new Error(`${missing} is not defined. This game's behaviour classes so far: ${known} — one only in an unspawned prefab appears once it exists; findAll('${missing}') works before then. A node by its name: #name. A module's own exports are not in scope: state to read here lives on a behaviour.`);
  };

  const expression = (code: string): (() => unknown) => {
    const vars = scope();
    // A condition is an expression, but statements that end in `return` — the shape `eval` takes — work too.
    const body = /(^|[;{}\s])return\b/.test(code) ? rewrite(code) : `return (${rewrite(code)});`;
    const fn = new Function(...Object.keys(vars), body) as (...args: unknown[]) => unknown;
    return () => {
      try {
        return fn(...Object.values(vars));
      } catch (error) {
        throw explain(error);
      }
    };
  };

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
    if (held.has(runtime)) stepFrames(frames, DT);
    await new Promise((done) => setTimeout(done, held.has(runtime) ? 0 : (frames * 1000) / 60));
    await nextPaint();
  };
  const hold = () => void held.add(runtime);

  // Input as the player's: DOM events where the player's would land, so the game's Input and any
  // HTML button read them alike. A key goes to whatever has focus, a pointer to what is under it.
  let pointerAt: [number, number] = [0, 0];
  let pointerTarget: Element | null = null;
  const key = (type: 'keydown' | 'keyup', name: string) => {
    const { code, key: text } = keyOf(name);
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent(type, { code, key: text, bubbles: true, cancelable: true }));
  };
  const pointer = (type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number, buttons: number) => {
    const target = type === 'pointerup' ? (pointerTarget ?? document.elementFromPoint(x, y)) : document.elementFromPoint(x, y);
    if (!target) throw new Error(`nothing on the page at (${x}, ${y}) — the window is ${innerWidth}×${innerHeight}.`);
    const init = { clientX: x, clientY: y, button: 0, buttons, pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true, cancelable: true, composed: true };
    target.dispatchEvent(new PointerEvent(type, init));
    const mouse = { pointerdown: 'mousedown', pointermove: 'mousemove', pointerup: 'mouseup' }[type];
    target.dispatchEvent(new MouseEvent(mouse, init));
    if (type === 'pointerup' && target === pointerTarget) target.dispatchEvent(new MouseEvent('click', init));
    pointerAt = [x, y];
    if (type === 'pointerdown') pointerTarget = target;
    if (type === 'pointerup') pointerTarget = null;
  };

  const bridge = {
    /** What this is and how to call it — the first thing to read. */
    help(): string {
      return HELP;
    },
    clock() {
      return { held: held.has(runtime), time: round(Time.time), frame: Time.frameCount, timeScale: Time.timeScale };
    },
    /**
     * Once the game has run its first frames. Behaviours start listening for input on their first
     * frames, so a key pressed sooner goes nowhere: call this before anything else.
     */
    async ready(frames = 3) {
      while (runtime.frame < frames) {
        if (held.has(runtime)) stepFrames(frames - runtime.frame, DT);
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
      held.delete(runtime);
      viewing.delete(runtime);
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
      const vars = scope();
      const fn = new Function(...Object.keys(vars), `return (async () => {\n${rewrite(code)}\n})();`) as (...args: unknown[]) => Promise<unknown>;
      let value: unknown;
      try {
        value = await fn(...Object.values(vars));
      } catch (error) {
        throw explain(error);
      }
      await nextPaint();
      // A behaviour returned whole reads as telemetry does: its fields and getters.
      if (value instanceof Behaviour) return { class: value.constructor.name, ...fields(value) };
      return plain(value, 3);
    },
    /** The first live behaviour of a class, by name — the object itself, to read or change. */
    find(type: string): Behaviour | null {
      return (scope().find as (t: string) => Behaviour | null)(type);
    },
    findAll(type: string): Behaviour[] {
      return (scope().findAll as (t: string) => Behaviour[])(type);
    },
    /** A node by the name it was given in the scene. */
    node(name: string): THREE.Object3D | null {
      return get().scene.getObjectByName(name) ?? null;
    },
    outline(depth = 4): string {
      const lines: string[] = [];
      const visit = (node: THREE.Object3D, level: number) => {
        const own = behavioursOn(node).filter((b) => !b.isDestroyed);
        const plainKids = node.children.filter((c) => !c.name && behavioursOn(c).length === 0 && !hasNamedOrBehaviour(c));
        const label = `${'  '.repeat(level)}- ${node.type}${node.name ? ` "${node.name}"` : ''} at ${fmt(node.getWorldPosition(new THREE.Vector3()))}`;
        const parts = own.map((b) => `${b.constructor.name}${b.enabled ? '' : ' (disabled)'} ${compact(fields(b))}`);
        lines.push(parts.length ? `${label} — ${parts.join(' · ')}` : label);
        if (level + 1 >= depth) {
          if (node.children.length) lines.push(`${'  '.repeat(level + 1)}(${node.children.length} children below the depth)`);
          return;
        }
        for (const child of node.children) if (!plainKids.includes(child)) visit(child, level + 1);
        if (plainKids.length) lines.push(`${'  '.repeat(level + 1)}(+${plainKids.length} unnamed ${plainKids.length === 1 ? 'object' : 'objects'} without behaviours)`);
      };
      visit(get().scene, 0);
      const c = bridge.clock();
      return `time ${c.time}s · frame ${c.frame} · timeScale ${c.timeScale}${c.held ? ' · clock held' : ''}\n${lines.join('\n')}`;
    },
    /** `Player` — every live Player; `Player.lane` — that field of each; `#runner` — a node by name. */
    telemetry(target: string): unknown {
      if (target.startsWith('#')) {
        const node = nodeNamed(target.slice(1));
        return {
          type: node.type,
          name: node.name,
          position: fmt(node.position),
          worldPosition: fmt(node.getWorldPosition(new THREE.Vector3())),
          rotation: fmt(node.rotation),
          scale: fmt(node.scale),
          visible: node.visible,
          children: node.children.length,
          behaviours: Object.fromEntries(behavioursOn(node).map((b) => [b.constructor.name, fields(b)])),
        };
      }
      const [type, ...path] = target.split('.');
      const list = byClass().get(type!);
      if (!list) {
        const known = [...byClass().keys()].sort().join(', ');
        throw new Error(`no live behaviour of class ${type}. Live classes: ${known || 'none'}`);
      }
      return list.map((b) => {
        const host = b.node as THREE.Object3D;
        const where = host.name || host.type;
        if (path.length === 0) return { on: where, at: fmt(host.getWorldPosition(new THREE.Vector3())), ...fields(b) };
        let value: unknown = b;
        for (const key of path) value = (value as Record<string, unknown>)?.[key];
        return { on: where, [path.join('.')]: plain(value, 2) };
      });
    },
    /**
     * Draw the scene from another viewpoint, holding the clock, until `view(null)` or `play()`: the
     * next screenshot of the page shows it, HUD and all.
     */
    async view(options: { cameraPos: number[]; lookAt?: number[] | string; fov?: number } | null) {
      if (!options) {
        viewing.delete(runtime);
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
        viewing.set(runtime, eye);
      }
      await nextPaint();
      return bridge.clock();
    },
    /** Hold a key for `frames` frames — `"Space"`, `"ArrowLeft"`, `"a"`, `"Enter"` — then let it go. */
    async press(name: string, frames = 6) {
      key('keydown', name);
      await pass(frames);
      key('keyup', name);
      await pass(1);
    },
    keyDown(name: string) {
      key('keydown', name);
    },
    keyUp(name: string) {
      key('keyup', name);
    },
    /** Click or tap at a point of the window, in pixels from its top-left; then a frame passes. */
    async click(x: number, y: number) {
      pointer('pointerdown', x, y, 1);
      pointer('pointerup', x, y, 0);
      await pass(1);
    },
    pointerDown(x: number, y: number) {
      pointer('pointerdown', x, y, 1);
    },
    pointerMove(x: number, y: number) {
      pointer('pointermove', x, y, pointerTarget ? 1 : 0);
    },
    pointerUp() {
      pointer('pointerup', ...pointerAt, 0);
    },
    /** Press at `from`, drag to `to` over `frames` frames, lift: a swipe. */
    async swipe(from: [number, number], to: [number, number], frames = 8) {
      pointer('pointerdown', from[0], from[1], 1);
      for (let i = 1; i <= frames; i++) {
        pointer('pointermove', from[0] + ((to[0] - from[0]) * i) / frames, from[1] + ((to[1] - from[1]) * i) / frames, 1);
        await pass(1);
      }
      pointer('pointerup', to[0], to[1], 0);
      await pass(1);
    },
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
    void drive(bridge as unknown as Bridge, script, scope);
  }
  // Where an agent's browser tools look first: the console says what drives the game.
  console.info(
    'SceNoCo: this game is driven from the page with window.__scenoco — call __scenoco.help(). ' +
      "A tool that cannot run JavaScript in the page drives it from the address and reads the console: ?drive=press('Space');until(Game.over);outline()",
  );
  return () => {
    held.delete(runtime);
    viewing.delete(runtime);
    restoreTimers();
    const w = window as unknown as { __scenoco?: unknown };
    if (w.__scenoco === bridge) delete w.__scenoco;
  };
}

type Bridge = Record<string, (...args: unknown[]) => unknown>;

/** What `?drive=` may call with data: every bridge method that answers with plain data, but `eval`. */
const DRIVE_CALLS = ['pause', 'play', 'clock', 'step', 'outline', 'telemetry', 'view', 'press', 'keyDown', 'keyUp', 'click', 'pointerDown', 'pointerMove', 'pointerUp', 'swipe'];

/**
 * `?drive=press('Space');until(GameState.phase == 'playing');read(count(Brick))` — drive the game to
 * the moment a check needs, from the address (`drive.ts`): each call waits for the one before, each
 * answer is one console line, and the clock stays held after the last, so the screenshot taken next
 * shows that moment. It reads data only, so a link from anywhere can do no more than press keys.
 */
async function drive(bridge: Bridge, script: string, scope: DriveScope): Promise<void> {
  let calls: DriveCall[];
  try {
    calls = parseDrive(script);
  } catch (error) {
    console.error(`[scenoco] ?drive= could not be read: ${error instanceof Error ? error.message : String(error)}. Write # as %23 in an address.`);
    return;
  }
  await bridge.ready!();
  bridge.pause!();
  for (const { name, args } of calls) {
    const call = `${name}(${args.map((a) => source(a)).join(', ')})`;
    try {
      let answer: unknown;
      if (name === 'until') answer = await bridge.until!(reader(args[0]!, scope), ...args.slice(1).map((a) => value(a, scope)));
      else if (name === 'read') answer = readable(reader(args[0]!, scope)());
      else if (name === 'watch') {
        const items = args[0]?.k === 'arr' ? args[0].items : args.slice(0, 1);
        const readers = new Map(items.map((item) => [source(item), reader(item, scope)]));
        answer = await bridge.watch!([...readers.keys()], ...[60, 10, DT].map((d, i) => (args[i + 1] ? value(args[i + 1]!, scope) : d)), (f: string) => readers.get(f)!);
      } else if (DRIVE_CALLS.includes(name)) answer = await bridge[name]!(...args.map((a) => value(a, scope)));
      else throw new Error(`there is no ${name}() — drive calls ${[...DRIVE_CALLS, 'until', 'watch', 'read'].join(', ')}`);
      console.info(`[scenoco] ${call} →`, typeof answer === 'string' ? `\n${answer}` : answer === undefined ? 'done' : JSON.stringify(answer));
    } catch (error) {
      console.error(`[scenoco] ${call} failed, and the calls after it did not run: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
  }
  console.info(`[scenoco] done, held at frame ${(bridge.clock!() as { frame: number }).frame}: a screenshot now shows this frame. Open the address without ?drive= to play.`);
}

/** A reading as one console line: a behaviour as its fields, as `eval` answers. */
function readable(value: unknown): unknown {
  if (value instanceof Behaviour) return { class: value.constructor.name, ...fields(value) };
  if (Array.isArray(value) && value.some((v) => v instanceof Behaviour)) return value.map(readable);
  return plain(value, 3);
}

const HELP = `window.__scenoco — the running SceNoCo game, from the page (development only).
Every method returns plain data; await the async ones. From Playwright: page.evaluate(() => __scenoco.until("Game.over")).

Clock — a held clock moves only when stepped, so every reading lands on an exact frame:
  pause()  play()  clock()
  step(frames = 1)                      advance exactly this many frames
  until(code, maxFrames = 600)          step until code is true: until("GameState.phase === 'over'")
  watch([code, …], frames = 60, every = 10)   rows of values over time: watch(["Player.lane", "Time.time"])
Reading — code is JavaScript where Player.lane is the first live Player's lane, #runner the node named "runner",
and find(Type) / findAll(Type) / node(name) / destroy / scene / camera / Time / Input / SceneManager / THREE are in scope:
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

/** A key by the name Playwright uses — "Space", "ArrowLeft", "a", "7" — as the DOM's code and key. */
function keyOf(name: string): { code: string; key: string } {
  if (name === ' ' || name === 'Space') return { code: 'Space', key: ' ' };
  if (/^[a-z]$/i.test(name)) return { code: `Key${name.toUpperCase()}`, key: name };
  if (/^\d$/.test(name)) return { code: `Digit${name}`, key: name };
  if (name === 'Shift' || name === 'Control' || name === 'Alt' || name === 'Meta') return { code: `${name}Left`, key: name };
  return { code: name, key: name };
}

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

function hasNamedOrBehaviour(node: THREE.Object3D): boolean {
  let found = false;
  node.traverse((n) => {
    if (n !== node && (n.name || behavioursOn(n).length)) found = true;
  });
  return found;
}

/** A behaviour's state: its own fields, then its getters — what a person would look at in an inspector. */
function fields(b: Behaviour): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(b)) {
    if (key.startsWith('_')) continue;
    const value = (b as unknown as Record<string, unknown>)[key];
    if (typeof value === 'function') continue;
    out[key] = plain(value, 1);
  }
  // Up to the framework's own base classes: `node`, `camera`, `enabled` are the same on every behaviour.
  for (let proto = Object.getPrototypeOf(b); proto && proto.constructor.name !== 'Behaviour'; proto = Object.getPrototypeOf(proto)) {
    for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(proto))) {
      if (!desc.get || key.startsWith('_') || key in out) continue;
      try {
        out[key] = plain(desc.get.call(b), 1);
      } catch {
        // a getter that needs something not there yet
      }
    }
  }
  return out;
}

/** A value as JSON in three's own vocabulary: vectors as arrays, colours as "#rrggbb", objects by name. */
function plain(value: unknown, depth: number): unknown {
  // Spelled out, because JSON drops it: `{ score: undefined }` came back as `{}`, and read as "no such thing".
  if (value === undefined) return '<undefined>';
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return round(value);
  if (typeof value === 'function') return `<function ${(value as { name?: string }).name || 'anonymous'}>`;
  if (typeof value !== 'object') return String(value);
  const v = value as Record<string, unknown> & { constructor: { name: string } };
  if (v.isVector2 || v.isVector3 || v.isVector4 || v.isQuaternion || v.isEuler) return fmt(v as unknown as THREE.Vector3);
  if (v.isColor) return `#${(value as THREE.Color).getHexString()}`;
  if (value instanceof THREE.Object3D) return `<${value.type}${value.name ? ` "${value.name}"` : ''}>`;
  if (value instanceof Behaviour) return `<${value.constructor.name}${value.isDestroyed ? ' destroyed' : ''}>`;
  if (value instanceof Event) return `<Event, ${value.listenerCount} listener${value.listenerCount === 1 ? '' : 's'}>`;
  if (Array.isArray(value)) {
    if (depth <= 0) return `<${value.length} items>`;
    const items = value.slice(0, 12).map((item) => plain(item, depth - 1));
    return value.length > 12 ? [...items, `… ${value.length - 12} more`] : items;
  }
  if (value instanceof Map || value instanceof Set) return `<${v.constructor.name}, ${value.size}>`;
  const proto = Object.getPrototypeOf(value);
  // A class instance by its name — or as native, when the name is a minifier's (Rapier's are).
  if (proto !== Object.prototype && proto !== null) return v.constructor.name.length > 2 ? `<${v.constructor.name}>` : '<native>';
  if (depth <= 0) return '<object>';
  return Object.fromEntries(Object.entries(v).map(([k, item]) => [k, plain(item, depth - 1)]));
}

function fmt(v: { toArray(): number[] } | THREE.Euler): number[] {
  return (v as { toArray(): unknown[] }).toArray().filter((x) => typeof x === 'number').map((x) => round(x as number));
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function compact(record: Record<string, unknown>): string {
  const text = JSON.stringify(record);
  return text.length > 220 ? `${text.slice(0, 217)}…}` : text;
}
