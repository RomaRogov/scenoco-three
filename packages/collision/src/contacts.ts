import type { Object3D } from 'three';

/**
 * The contact hooks a component may implement — the same four `@scenoco-three/rapier` dispatches.
 *
 * Behaviour written against one back-end runs unchanged on the other.
 *
 * Declared as an interface and merged onto `Component`, the way core declares its own
 * lifecycle hooks, which is what makes them typed: `override onCollisionEnter(other: Object3D)`
 * is checked by the compiler.
 */
export interface ContactHandlers {
  /** A solid (non-sensor) overlap began with `other`. */
  onCollisionEnter?(other: Object3D): void;
  /** A solid overlap ended with `other`. */
  onCollisionExit?(other: Object3D): void;
  /** A sensor overlap began with `other`. */
  onTriggerEnter?(other: Object3D): void;
  /** A sensor overlap ended with `other`. */
  onTriggerExit?(other: Object3D): void;
}

declare module '@scenoco-three/core' {
  interface Component extends ContactHandlers {}
}
