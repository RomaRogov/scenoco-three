import type { Object3D } from 'three';

/**
 * The tap hook a component may implement.
 *
 * Declared as an interface and merged onto `Component`, the way `@scenoco-three/collision`
 * declares its contact hooks and the way core declares its own lifecycle — which is what makes
 * it typed: `override onTap()` is checked by the compiler, and a misspelling is an error rather
 * than a handler that silently never fires.
 */
export interface TapHandlers {
  /** The player tapped this node, or something under it. */
  onTap?(hit: Object3D): void;
}

declare module '@scenoco-three/core' {
  interface Component extends TapHandlers {}
}
