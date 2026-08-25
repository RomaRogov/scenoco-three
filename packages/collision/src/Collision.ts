import type { Object3D } from 'three';
import { System } from '@scenoco-three/core';
import type { Bounds, Collider } from './Collider.js';
import { overlaps } from './overlap.js';

/**
 * The detection-only collision world.
 *
 * Once a frame it recomputes every collider's world bounds, tests all pairs, and — the frame an
 * overlap begins or ends — dispatches the **same contact hooks rapier does**:
 * `onCollisionEnter` / `onCollisionExit` for solid pairs, `onTriggerEnter` / `onTriggerExit`
 * when either side is a sensor. Each hook receives the other node.
 *
 * No bodies, no forces, no resolution. For real physics use `@scenoco-three/rapier`, which
 * exports the same tags and the same hooks.
 *
 * Pairs are tested O(n²). That is honest for the scale this is for — a few dozen shapes — and a
 * broad phase is what to add when profiling says so, not before.
 */
export class Collision extends System {
  private readonly colliders: Collider[] = [];
  /** Bounds for this frame, index-aligned with `colliders`. */
  private readonly bounds: Bounds[] = [];
  /** Pairs overlapping last frame, so an exit can be told from a touch that continues. */
  private previous = new Set<string>();
  private current = new Set<string>();
  /** What a pair key stands for, so an exit can name both sides after the fact. */
  private readonly pairs = new Map<string, [Collider, Collider]>();
  private readonly ids = new WeakMap<Collider, number>();
  private nextId = 1;

  /** @internal called by `Collider.awake`. */
  add(collider: Collider): void {
    if (!this.colliders.includes(collider)) this.colliders.push(collider);
  }

  /** @internal called by `Collider.onDestroy`. */
  remove(collider: Collider): void {
    const index = this.colliders.indexOf(collider);
    if (index !== -1) this.colliders.splice(index, 1);
  }

  override update(): void {
    const colliders = this.colliders;
    if (colliders.length === 0) {
      this.previous.clear();
      return;
    }
    // World bounds are read off world matrices, and a node moved this frame has not had one
    // recomputed yet — the renderer would do it later, which is too late to test against.
    this.scene.updateMatrixWorld();

    this.bounds.length = colliders.length;
    for (let i = 0; i < colliders.length; i++) this.bounds[i] = colliders[i]!.worldBounds();

    this.current.clear();
    for (let i = 0; i < colliders.length; i++) {
      const a = colliders[i]!;
      // A destroyed or disabled collider is treated as gone: it forms no pair, so the diff
      // below emits its exits by itself. That is Unity's behaviour for a disabled collider.
      if (!a.isActiveAndEnabled) continue;
      for (let j = i + 1; j < colliders.length; j++) {
        const b = colliders[j]!;
        if (!b.isActiveAndEnabled) continue;
        // Two shapes on one node describe one thing; they do not touch each other.
        if (a.object3D === b.object3D) continue;
        if (!overlaps(this.bounds[i]!, this.bounds[j]!)) continue;

        const key = this.pairKey(a, b);
        this.current.add(key);
        this.pairs.set(key, [a, b]);
        if (!this.previous.has(key)) emit(a, b, 'enter');
        this.previous.delete(key);
      }
    }

    // Whatever is left in `previous` did not overlap this frame, so it just ended.
    for (const key of this.previous) {
      const pair = this.pairs.get(key);
      if (pair) emit(pair[0], pair[1], 'exit');
      this.pairs.delete(key);
    }

    // Swap the two sets rather than allocating: the one just drained becomes next frame's.
    const drained = this.previous;
    this.previous = this.current;
    this.current = drained;
  }

  override onDestroy(): void {
    this.colliders.length = 0;
    this.bounds.length = 0;
    this.previous.clear();
    this.current.clear();
    this.pairs.clear();
  }

  /** A stable key for an unordered pair. Ids are assigned on first sight and never reused. */
  private pairKey(a: Collider, b: Collider): string {
    const first = this.idOf(a);
    const second = this.idOf(b);
    return first < second ? `${first}:${second}` : `${second}:${first}`;
  }

  private idOf(collider: Collider): number {
    let id = this.ids.get(collider);
    if (id === undefined) this.ids.set(collider, (id = this.nextId++));
    return id;
  }
}

type ContactPhase = 'enter' | 'exit';

/** Tell both sides about a pair that just began or ended overlapping. */
function emit(a: Collider, b: Collider, phase: ContactPhase): void {
  const sensor = a.isSensor || b.isSensor;
  dispatch(a.object3D, b.object3D, sensor, phase);
  dispatch(b.object3D, a.object3D, sensor, phase);
}

/** Call every contact hook on `node` that wants to hear about `other`. */
function dispatch(node: Object3D, other: Object3D, sensor: boolean, phase: ContactPhase): void {
  for (const component of node.components) {
    if (component.isDestroyed || component._pendingDestroy) continue;
    const hook = sensor
      ? phase === 'enter'
        ? component.onTriggerEnter
        : component.onTriggerExit
      : phase === 'enter'
        ? component.onCollisionEnter
        : component.onCollisionExit;
    hook?.call(component, other);
  }
}
