/**
 * TSX that builds three.js objects — no React. `<Mesh castShadow>` is `new Mesh()` with
 * `castShadow = true`, made the moment the expression runs; its children are added to it.
 *
 * The conventions are R3F's, so a model already knows them: `args` are the constructor's arguments,
 * a value goes through the property's own `set` or `copy` (`position={[0, 1, 2]}`, `color="#f80"`,
 * `scale={2}`), a dashed name reaches inside (`shadow-mapSize={[2048, 2048]}`), and a child that is
 * not an `Object3D` is assigned to the property `attach` names — `geometry` and `material` by default.
 * A node child is always added; with `attach` it fills that property too, as a light's `target` does.
 * A behaviour class is an element too: it becomes a component of its parent.
 */
import { addDormant, afterNodeDestroyed } from './kernel/runtime.js';
import { disposeBuilt, ownedBy } from './dispose.js';
import { Behaviour } from './kernel/Behaviour.js';
import type { BehaviourInit, ConstructableBehaviour, RefLike } from './kernel/types.js';

/** A typed link to an element, set when the element is made: `const hero = ref<Mesh>()`, `<Mesh ref={hero}>`. */
export interface Ref<T> {
  current: T | null;
}

/** A typed link for `ref={…}` — and for a behaviour's field, which reads it once the scene is built. */
export function ref<T>(): Ref<T> {
  return { current: null };
}

export const Fragment = Symbol.for('scenoco.fragment');

const MARKER = Symbol.for('scenoco.marker');

/** What behaviour tag (e.g. `<Spinner speed={2} />`) evaluates to: a note for its parent, which adds the behaviour. */
interface BehaviourMarker {
  readonly [MARKER]: true;
  readonly type: ConstructableBehaviour;
  readonly init: Record<string, unknown>;
}

function isBehaviourClass(type: unknown): type is ConstructableBehaviour {
  return typeof type === 'function' && type.prototype instanceof Behaviour;
}

function isMarker(value: unknown): value is BehaviourMarker {
  return typeof value === 'object' && value !== null && (value as BehaviourMarker)[MARKER] === true;
}

function marker(type: ConstructableBehaviour, props: Record<string, unknown>): BehaviourMarker {
  const { children, key: _key, ...init } = props;
  if (children !== undefined) throw new Error(`<${type.name}> is a behaviour and takes no children.`);
  return { [MARKER]: true, type, init };
}

// A destroyed node takes what its elements built with it.
afterNodeDestroyed(disposeBuilt);

/** The `attach` an element was made with, read when its parent adds it. */
const ATTACH = new WeakMap<object, string>();

type Props = Record<string, unknown> & { children?: unknown };

/** The automatic JSX runtime's entry: build the element now and return it. */
export function jsx(type: unknown, props: Props | null, _key?: unknown): unknown {
  const all = props ?? {};
  if (type === Fragment) return flatten(all.children);
  if (isBehaviourClass(type)) return marker(type, all);
  if (typeof type !== 'function') throw new TypeError(`<${String(type)}> is not a class: a tag is a class you import — <Mesh>, not <mesh>.`);

  if (!isClass(type)) {
    // A function returning TSX — a prefab. Remember which one made the node, and whether it was given
    // anything, so an export can keep `<ArrowBase />` a nested prefab rather than copy what it built.
    const made = (type as (p: Props) => unknown)(all);
    if (made && typeof made === 'object' && !Array.isArray(made)) {
      const { children: _c, key: _k2, ...given } = all;
      madeBy.set(made, { prefab: type as () => unknown, given: Object.keys(given).length > 0 });
    }
    return made;
  }

  const { args, attach, ref: link, children, key: _k, ...rest } = all;
  const instance = new (type as new (...a: unknown[]) => Record<string, unknown>)(...((args as unknown[]) ?? []));
  for (const [key, value] of Object.entries(rest)) applyProp(instance, key, value, type.name);
  for (const child of flatten(children)) addChild(instance, child, type.name);
  if (typeof attach === 'string') ATTACH.set(instance, attach);
  if (link && typeof link === 'object' && 'current' in link) (link as Ref<unknown>).current = instance;
  return instance;
}
export const jsxs = jsx;

/** Where an element was written: what `jsxDEV` is told in development, 1-based, at the `<`. */
export interface Source {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
}
const sources = new WeakMap<object, Source>();

/** The prefab function whose element made a node, and whether that element passed it attributes. */
const madeBy = new WeakMap<object, { prefab: () => unknown; given: boolean }>();

/** @internal What an export reads: the prefab that made `node`, if a `<Prefab />` element did. */
export function prefabOf(node: object): { prefab: () => unknown; given: boolean } | undefined {
  return madeBy.get(node);
}


/**
 * Where the element that made this object — a node, a material, a behaviour — was written. Development
 * builds only: what lets an editor go from a picked object to its tag.
 */
export function sourceOf(made: object): Source | undefined {
  return sources.get(made);
}

/** Development's entry: the same as `jsx`, and it remembers where each element was written. */
export function jsxDEV(type: unknown, props: Props | null, key?: unknown, _static?: boolean, source?: Source): unknown {
  const made = jsx(type, props, key);
  if (source && made && typeof made === 'object' && !Array.isArray(made)) sources.set(made, source);
  return made;
}

function isClass(fn: Function): boolean {
  return /^class[\s{]/.test(Function.prototype.toString.call(fn));
}

function flatten(children: unknown): unknown[] {
  if (children === undefined || children === null || children === false || children === true) return [];
  return Array.isArray(children) ? children.flatMap(flatten) : [children];
}

/** `key` on `target`, R3F's way: a dashed name walks in, then the property's own `set`/`copy` takes the value. */
/** @internal */
export function applyProp(target: Record<string, unknown>, key: string, value: unknown, tag: string): void {
  let owner = target;
  let name = key;
  if (key.includes('-') && !(key in target)) {
    const path = key.split('-');
    name = path.pop()!;
    for (const step of path) {
      const next = owner[step];
      if (!next || typeof next !== 'object') throw new Error(`<${tag} ${key}>: ${tag} has no "${step}" to reach into.`);
      owner = next as Record<string, unknown>;
    }
  }
  const current = owner[name] as Record<string, unknown> | null | undefined;
  // A value (a vector, a colour) is copied into the one the object owns; a thing with a `uuid` (a
  // geometry, a material, a texture) is assigned, so `material={paint.stone}` shares paint.stone.
  if (current && typeof current === 'object' && value !== null && value !== undefined && !('uuid' in current)) {
    const set = current.set as ((...a: unknown[]) => void) | undefined;
    if (value instanceof (current.constructor as new () => unknown) && typeof current.copy === 'function') {
      (current.copy as (v: unknown) => void)(value);
      return;
    }
    if (Array.isArray(value) && typeof set === 'function') return void set.apply(current, value);
    if (typeof value === 'number' && typeof current.setScalar === 'function') return void (current.setScalar as (n: number) => void)(value);
    if ((typeof value === 'string' || typeof value === 'number') && typeof set === 'function') return void set.call(current, value);
  }
  owner[name] = value;
}

/** A child is added if it is a node, attached if `attach` or its kind names a property — both, for a node with `attach` — made a component if it is a behaviour. */
function addChild(parent: Record<string, unknown>, child: unknown, tag: string): void {
  if (isMarker(child)) {
    const behaviour = addDormant(parent as never, child.type, child.init);
    const source = sources.get(child);
    if (source) sources.set(behaviour, source);
    return;
  }
  if (!child || typeof child !== 'object') {
    throw new Error(`<${tag}> got ${JSON.stringify(child)} as a child: a scene's children are elements.`);
  }
  const value = child as Record<string, unknown>;
  const attach = attachOf(value);
  const node = value.isObject3D === true && typeof parent.add === 'function';
  if (attach) applyAttach(parent, attach, value, tag);
  // A node is always in the scene, attached or not: `<Object3D attach="target" />` under a light is
  // its target and its child, so it moves with the light — three.js wants a light's target in the scene.
  if (node) return void (parent.add as (c: unknown) => void)(value);
  if (attach) return;
  throw new Error(
    `<${(value.constructor as Function).name}> inside <${tag}> needs attach="…" — the property of ${tag} it fills.`,
  );
}

/** Where a non-node child goes: its `attach` prop, else R3F's defaults — geometry and material. */
function attachOf(child: Record<string, unknown>): string | undefined {
  return ATTACH.get(child) ?? (child.isBufferGeometry ? 'geometry' : child.isMaterial ? 'material' : undefined);
}

function applyAttach(parent: Record<string, unknown>, path: string, child: unknown, tag: string): void {
  const steps = path.split('-');
  const last = steps.pop()!;
  let owner = parent;
  for (const step of steps) owner = owner[step] as Record<string, unknown>;
  if (!owner) throw new Error(`<${tag}>: attach="${path}" — ${tag} has no "${steps.join('-')}".`);
  owner[last] = child;
  if (child && typeof child === 'object') ownedBy(child, parent);
}

// --- types: a class is an element, its fields are attributes ------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBehaviour = Behaviour<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClass = abstract new (...args: any[]) => any;

/** What `set(…)` takes, as one value when it takes one — `'#f80'` for a colour, `[0, 1, 2]` for a vector. */
type SetArgs<A> = A extends [infer Only] ? Only | A : A;
/** A property's value, or what its own `set`/`setScalar` accepts — R3F's shorthand. */
export type Settable<V> =
  | V
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | (V extends { set(...args: infer A): any } ? SetArgs<A> : never)
  | (V extends { setScalar(scalar: number): unknown } ? number : never);

/** Every data property of an instance, optional, with its shorthand. */
export type PropsOf<I> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof I as K extends string ? (I[K] extends (...args: any[]) => any ? never : K) : never]?: Settable<I[K]>;
};

/**
 * Every overload's parameters — `ConstructorParameters` sees only the last one, and three.js
 * overloads constructors: `new Color('#f80')` and `new Color(1, 0.5, 0)`.
 */
type CtorArgs<C> = C extends {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (...a: infer A1): any; new (...a: infer A2): any; new (...a: infer A3): any; new (...a: infer A4): any;
}
  ? A1 | A2 | A3 | A4
  : C extends abstract new (...a: infer A) => unknown
    ? A
    : never;

/** Names the element itself uses, never one of the instance's properties — `children` is three's own field too. */
type Reserved = 'children' | 'args' | 'attach' | 'ref' | 'key';

export type ClassProps<C extends AnyClass> = Omit<PropsOf<InstanceType<C>>, Reserved> & {
  /** The constructor's arguments: `<BoxGeometry args={[1, 2, 3]} />` is `new BoxGeometry(1, 2, 3)`. */
  args?: CtorArgs<C>;
  /** The parent's property this fills — `attach="fog"`, `attach="material-0"`. Geometry and material need none. */
  attach?: string;
  ref?: Ref<InstanceType<C>>;
  children?: unknown;
  key?: string | number;
};

export declare namespace ThreeJSX {
  type ElementType = AnyClass | ((props: never) => unknown);
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Element {}
  /** Open, so any class is an element. */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ElementClass {}
  /** Empty, so a class's attributes come from `LibraryManagedAttributes`, not from a `props` field. */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ElementAttributesProperty {}
  interface ElementChildrenAttribute {
    children: unknown;
  }
  type LibraryManagedAttributes<C, P> = C extends abstract new (...args: never) => infer I
    ? I extends AnyBehaviour
      ? BehaviourInit<I> & { key?: string | number }
      : C extends AnyClass
        ? ClassProps<C>
        : P
    : P;
  interface IntrinsicAttributes {
    key?: string | number;
  }
  /** None: a tag is a class you import. `<mesh>` is an error; write `<Mesh>`. */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface IntrinsicElements {}
}

export type { RefLike };
