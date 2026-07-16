import type { Object3D, Vector3 } from 'three';
import { Component, property, ValueType } from '@scenoco-three/core';

/** World-space bounds the overlap tests consume (filled by each collider per step). */
export type Bounds =
  | { shape: 'box'; center: Vector3; half: Vector3 }
  | { shape: 'capsule'; a: Vector3; b: Vector3; radius: number };

/**
 * Optional contact callbacks a component may implement — **the exact hooks
 * `@scenoco-three/rapier` dispatches**, so behaviour code (a `Bullet` that
 * despawns `onCollisionEnter`) is identical whether you use rapier or this
 * detection-only system. A non-sensor overlap fires the `onCollision*` pair; a
 * sensor overlap fires `onTrigger*`. Each receives the **other** node.
 */
export interface ContactHandlers {
  onCollisionEnter?(other: Object3D): void;
  onCollisionExit?(other: Object3D): void;
  onTriggerEnter?(other: Object3D): void;
  onTriggerExit?(other: Object3D): void;
}

/**
 * Shared base for the collision shapes — API-identical to rapier's `Collider`
 * (`<BoxCollider>`, `<SphereCollider>`, `<CapsuleCollider>`, `<CylinderCollider>`,
 * `<PlaneCollider>`) so a scene and its component code switch between the two
 * engines by only swapping the import. Concrete shapes implement {@link worldBounds}.
 *
 * **Detection only — no dynamics.** `restitution`/`friction`/`density` are accepted
 * for rapier compatibility but inert here; overlaps drive `onCollisionEnter/Exit`
 * (or `onTriggerEnter/Exit` when `isSensor`). The tags share rapier's names on
 * purpose — importing both packages throws, so a project picks one engine.
 */
export abstract class Collider extends Component {
  @property({ type: ValueType.Float, default: 0, description: 'Bounciness 0..1 (inert in detection-only mode)' })
  restitution = 0;
  @property({ type: ValueType.Float, default: 0.5, description: 'Friction 0..1 (inert in detection-only mode)' })
  friction = 0.5;
  @property({ type: ValueType.Float, default: 1, description: 'Density (inert in detection-only mode)' })
  density = 1;
  @property({ type: ValueType.Bool, default: false, description: 'A trigger: reports overlaps via onTriggerEnter (else onCollisionEnter)' })
  isSensor = false;

  /** @internal Current world-space bounds, recomputed by the CollisionSystem each step. */
  abstract worldBounds(): Bounds;
}
