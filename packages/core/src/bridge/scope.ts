/**
 * What `eval`, `until` and `watch` can name, and how a reading written the way a model writes it is
 * made to work: `Player.lane` is the first live Player's lane, `#runner` the node named "runner", and
 * a name that is not there is answered with the names that are.
 */
import * as THREE from 'three';
import {
  Behaviour,
  Time,
  behavioursOn,
  destroy,
  getComponent,
  getComponentInChildren,
  getComponentInParent,
  getComponents,
  getComponentsInChildren,
} from '../kernel/index.js';
import { Input } from '../input/Input.js';
import { SceneManager } from '../scenes.js';

/** What the bridge reads from whatever draws the frame. */
export interface ObservedState {
  scene: THREE.Scene;
  camera: THREE.Camera | null;
  gl: THREE.WebGLRenderer;
  size: { width: number; height: number };
}

export type Scope = ReturnType<typeof createScope>;

/** The game's names, read afresh from `get()` on every call. */
export function createScope(get: () => ObservedState) {
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
      getComponent,
      getComponents,
      getComponentInChildren,
      getComponentsInChildren,
      getComponentInParent,
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
    // Only a class is capitalised: anything else missing is a helper this scope does not have.
    if (!/^[A-Z]/.test(missing)) {
      const helpers = Object.keys(scope()).filter((name) => !name.startsWith('__') && !learnClasses().has(name));
      return new Error(`${missing} is not in this scope. What is: ${helpers.join(', ')} — and the game's behaviour classes: ${known}.`);
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

  /** The body of an async function, with the game's names in scope: what it returns. */
  const run = async (code: string): Promise<unknown> => {
    const vars = scope();
    const fn = new Function(...Object.keys(vars), `return (async () => {\n${rewrite(code)}\n})();`) as (...args: unknown[]) => Promise<unknown>;
    try {
      return await fn(...Object.values(vars));
    } catch (error) {
      throw explain(error);
    }
  };

  return { learnClasses, byClass, nodeNamed, of, scope, expression, run };
}
