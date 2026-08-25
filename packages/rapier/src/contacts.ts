import type { Object3D } from 'three';

/**
 * The contact hooks a component may implement, named as Unity names them.
 *
 * Declared as an interface and merged onto `Component`, exactly the way core declares its own
 * lifecycle hooks — which is what makes them **typed**: `override onCollisionEnter(other:
 * Object3D)` is checked by the compiler, and a misspelling is a build error rather than a hook
 * that silently never fires.
 *
 * `@scenoco-three/collision` declares the same four, so behaviour written against one back-end
 * runs unchanged on the other.
 */
export interface ContactHandlers {
  /** A solid (non-sensor) collision began with `other`. */
  onCollisionEnter?(other: Object3D): void;
  /** A solid collision ended with `other`. */
  onCollisionExit?(other: Object3D): void;
  /** A sensor overlap began with `other`. */
  onTriggerEnter?(other: Object3D): void;
  /** A sensor overlap ended with `other`. */
  onTriggerExit?(other: Object3D): void;
}

declare module '@scenoco-three/core' {
  interface Component extends ContactHandlers {}
}
