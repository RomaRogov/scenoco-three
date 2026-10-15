/**
 * Dev only: what the observer drives the page through, and a warning about timers.
 *
 * `play()` installs `window.__behaviours` when Vite serves the page in development. The
 * observer holds the clock with it — the host stops calling `runtime.update` — and steps exact
 * frames, so a reading or a screenshot lands on the frame it names. It reads game state by
 * behaviour class and node name: nothing in the game has to expose anything for it.
 */
import * as THREE from 'three';
import { Behaviour, Event, Runtime, Time, behavioursOn, destroy } from './kernel/index.js';
import { Input } from './input/Input.js';
import { SceneManager } from './scenes.js';

/** What the bridge reads from whatever draws the frame. */
export interface ObservedState {
  scene: THREE.Scene;
  camera: THREE.Camera;
  gl: THREE.WebGLRenderer;
  size: { width: number; height: number };
}

const held = new WeakSet<Runtime>();

/** @internal true while the observer holds this runtime's clock. */
export function isHeld(runtime: Runtime): boolean {
  return held.has(runtime);
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
   * named "runner". A class is still a class where it is not followed by a dot: `findAll(Coin)`.
   */
  const rewrite = (code: string): string => {
    let body = code.replace(/(^|[^\w'"`])#([A-Za-z_][\w-]*)/g, (_, before: string, name: string) => `${before}__node(${JSON.stringify(name)})`);
    // A class no live object has shown yet — only in a prefab that has not been built — is still a
    // fine thing to search for: `findAll(Magnet)` is `findAll("Magnet")`, an empty list until one exists.
    const known = learnClasses();
    body = body.replace(/\b(find|findAll|findObjectOfType|findObjectsOfType)\(\s*([A-Z]\w*)\s*\)/g, (call, fn: string, name: string) =>
      known.has(name) ? call : `${fn}(${JSON.stringify(name)})`,
    );
    for (const name of learnClasses().keys()) body = body.replace(new RegExp(`\\b${name}\\b(?=\\s*\\.)`, 'g'), `find(${JSON.stringify(name)})`);
    return body;
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

  const nextPaint = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));

  const stepFrames = (frames: number, dt: number): void => {
    for (let i = 0; i < frames; i++) frame(dt);
  };

  const bridge = {
    get held(): boolean {
      return held.has(runtime);
    },
    hold(on: boolean): void {
      if (on) held.add(runtime);
      else held.delete(runtime);
    },
    clock() {
      return { held: held.has(runtime), time: round(Time.time), frame: Time.frameCount, timeScale: Time.timeScale };
    },
    /** Advance exactly `frames` frames of `dt` each, then let the page paint them. */
    async step(frames: number, dt: number) {
      stepFrames(frames, dt);
      await nextPaint();
      return bridge.clock();
    },
    /** Step until `code` is true, at most `maxFrames`. */
    async until(code: string, maxFrames: number, dt: number) {
      const test = expression(code);
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
    /** Step `frames`, reading each expression every `every` frames. A table, one row per sample. */
    async watch(fields: string[], frames: number, every: number, dt: number) {
      const readers = fields.map((field) => ({ field, read: expression(field) }));
      const rows: string[] = [['t', 'frame', ...fields].join('\t')];
      const sample = () => {
        const values = readers.map(({ read }) => {
          try {
            return JSON.stringify(plain(read(), 1));
          } catch (error) {
            return `!${(error as Error).message}`;
          }
        });
        rows.push([round(Time.time), Time.frameCount, ...values].join('\t'));
      };
      sample();
      for (let done = 0; done < frames; ) {
        const n = Math.min(every, frames - done);
        stepFrames(n, dt);
        done += n;
        sample();
      }
      await nextPaint();
      return rows.join('\n');
    },
    async evaluate(code: string): Promise<unknown> {
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
    outline(depth: number): string {
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
      return `time ${c.time}s · frame ${c.frame} · timeScale ${c.timeScale}${c.held ? ' · held by the observer' : ''}\n${lines.join('\n')}`;
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
    /** A picture from another viewpoint, rendered into the canvas and read back at once. No HUD. */
    view(options: { cameraPos: number[]; lookAt?: number[] | string; fov?: number }): string {
      const { gl, scene, camera, size } = get();
      const eye = new THREE.PerspectiveCamera(options.fov ?? (camera as THREE.PerspectiveCamera).fov ?? 50, size.width / size.height, 0.05, 2000);
      eye.position.fromArray(options.cameraPos);
      const target =
        typeof options.lookAt === 'string'
          ? nodeNamed(options.lookAt.replace(/^#/, '')).getWorldPosition(new THREE.Vector3())
          : new THREE.Vector3().fromArray(options.lookAt ?? [0, 0, 0]);
      eye.lookAt(target);
      gl.render(scene, eye);
      return gl.domElement.toDataURL('image/png');
    },
  };

  (window as unknown as { __behaviours?: unknown }).__behaviours = bridge;
  return () => {
    held.delete(runtime);
    restoreTimers();
    const w = window as unknown as { __behaviours?: unknown };
    if (w.__behaviours === bridge) delete w.__behaviours;
  };
}

/**
 * A timer started from inside a frame is game code timing itself outside the game clock: it keeps
 * counting at `Time.timeScale = 0` and while the observer steps frames. Say so once, with the fix.
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
