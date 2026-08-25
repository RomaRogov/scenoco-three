import type { Object3D } from 'three';

/**
 * The contact hooks a component may implement, named as Unity names them.
 *
 * These are declared as an interface and merged onto `Component`, exactly the way core declares
 * its own lifecycle hooks. That is what makes them **typed**: `override onCollisionEnter2D(other:
 * Object3D)` is checked by the compiler, a misspelling is an error rather than a hook that
 * silently never fires, and "find all references" finds every handler.
 */
export interface Contact2DHandlers {
  /** A solid (non-sensor) collision began with `other`. */
  onCollisionEnter2D?(other: Object3D): void;
  /** A solid collision ended with `other`. */
  onCollisionExit2D?(other: Object3D): void;
  /** A sensor overlap began with `other`. */
  onTriggerEnter2D?(other: Object3D): void;
  /** A sensor overlap ended with `other`. */
  onTriggerExit2D?(other: Object3D): void;
}

declare module '@scenoco-three/core' {
  interface Component extends Contact2DHandlers {}
}
