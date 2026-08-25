import type { Vector3 } from 'three';
import { Component } from '@scenoco-three/core';
import { Collision } from './Collision.js';

/** An axis-aligned box in world space. */
export interface BoxBounds {
  shape: 'box';
  center: Vector3;
  half: Vector3;
}

/** A segment with a radius. A sphere is one whose segment has zero length. */
export interface CapsuleBounds {
  shape: 'capsule';
  a: Vector3;
  b: Vector3;
  radius: number;
}

/** World-space bounds the overlap tests consume, filled by each collider once per frame. */
export type Bounds = BoxBounds | CapsuleBounds;

/**
 * Shared base for the collision shapes — **API-identical to rapier's `Collider`** so a scene
 * and its component code switch between the two back-ends by swapping the import.
 *
 * **Detection only, no dynamics.** `restitution`, `friction` and `density` are accepted for
 * that compatibility and are inert here; overlaps drive the contact hooks and nothing moves.
 *
 * A collider registers itself with the `Collision` system, so there is nothing to install and
 * nothing that scans the scene looking for shapes.
 *
 * Abstract, so it is machinery rather than a tag a document can write.
 */
export abstract class Collider extends Component {
  /** Bounciness, 0..1. Inert here; kept so a scene reads the same on either back-end. */
  restitution = 0;
  /** Friction, 0..1. Inert here. */
  friction = 0.5;
  /** Density in kg/m³. Inert here. */
  density = 1;
  /** A trigger: fires the `onTrigger*` pair instead of `onCollision*`. */
  isSensor = false;

  /** This collider's bounds in world space, recomputed each frame. */
  abstract worldBounds(): Bounds;

  override awake(): void {
    this.requireSystem(Collision).add(this);
  }

  override onDestroy(): void {
    this.getSystem(Collision)?.remove(this);
  }
}
