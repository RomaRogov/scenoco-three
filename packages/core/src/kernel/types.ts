import type { Object3D } from 'three';
import type { Behaviour } from './Behaviour.js';

/** A node of the scene graph: three.js's `Object3D`. */
export type Node = Object3D;

/** Any behaviour class, abstract ones included — what the lookups take. */
export type BehaviourType<T extends Behaviour = Behaviour> = abstract new () => T;

/** A behaviour class that can be constructed — what `addComponent` takes. No constructor arguments. */
export type ConstructableBehaviour<T extends Behaviour = Behaviour> = new () => T;

/** The node class a behaviour declares it drives: `Behaviour<Mesh>` → `Mesh`. */
export type NodeOf<T extends Behaviour> = T extends Behaviour<infer N> ? N : Object3D;

/** Unity's message methods, camelCase. Every one is optional; a behaviour is called only for what it defines. */
export interface BehaviourHooks {
  /** Once, when the behaviour first lands in a running scene — before any `start`. */
  awake?(): void;
  /** Each time it becomes enabled and in a running scene. */
  onEnable?(): void;
  /** Once, before its first `fixedUpdate`/`update`. Fields set right after `instantiate` are in. */
  start?(): void;
  /** At a fixed rate (`Runtime.fixedDelta`, 50 Hz by default), for physics-like work. */
  fixedUpdate?(dt: number): void;
  /** Every frame. */
  update?(dt: number): void;
  /** Every frame, after every `update` — cameras that follow. */
  lateUpdate?(dt: number): void;
  /** Each time it stops being enabled or leaves the running scene. */
  onDisable?(): void;
  /** Once, at the end of the frame it was destroyed in. */
  onDestroy?(): void;
}

// --- authorable fields ------------------------------------------------------------------------

type IsIdentical<X, Y, Then, Else> =
  (<G>() => G extends X ? 1 : 2) extends <G>() => G extends Y ? 1 : 2 ? Then : Else;

declare const prefab: unique symbol;

/**
 * A prefab as a field's type, Unity's `public GameObject prefab`: `projectile: Prefab | null = null`,
 * set in TSX as `<Tower projectile={Arrow} />`, built with `instantiate(this.projectile)`. Any
 * function returning TSX is one. Typed this way, the field is a setting; typed `() => Object3D`,
 * tsc cannot tell it from a method, and it would not be.
 */
export type Prefab<T extends Object3D = Object3D> = (() => unknown) & { readonly [prefab]?: T };

/** True for data, false for methods — a class (a behaviour type) and a `Prefab` count as data. */
type IsValue<V> = V extends Function
  ? V extends abstract new (...args: never[]) => unknown
    ? true
    : typeof prefab extends keyof V
      ? true
      : false
  : true;

/** Plain settable data fields: no methods, no readonly fields (and so no getters). */
type AuthorableKeys<T> = {
  [K in keyof T]-?: IsValue<T[K]> extends true
    ? IsIdentical<{ [Q in K]: T[K] }, { -readonly [Q in K]: T[K] }, K, never>
    : never;
}[keyof T];

/** A React ref, or anything else with `current`. */
export interface RefLike<T> {
  readonly current: T | null;
}

/**
 * What a field accepts besides itself — the conventions three.js and R3F already use: a colour from
 * `'#ff8800'`, a vector from `[1, 2, 3]`, and for a link to an object, a ref to it, read once the
 * scene is built.
 */
export type InitValue<V> = V extends RefLike<unknown>
  ? 'a ref given to a field arrives as the object it points at: declare the field as the object — target: Mesh | null = null'
  : V extends { isColor: true }
  ? V | string | number
  : V extends { fromArray(array: number[]): unknown }
    ? V | number[]
    : V extends object
      ? V | RefLike<V>
      : V;

/** The settings a behaviour exposes: its public data fields, every one optional. */
export type BehaviourInit<T extends Behaviour> = {
  [K in Exclude<AuthorableKeys<T>, keyof Behaviour>]?: InitValue<T[K]>;
};
