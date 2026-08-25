import { Component } from '@scenoco-three/core';

/** How a body would move, if this back-end had dynamics. Rapier's names. */
export type RigidBodyKind = 'dynamic' | 'fixed' | 'kinematic';

/**
 * Accepted so a scene reads the same on this back-end as on `@scenoco-three/rapier`, and
 * **inert**: this package detects overlaps and dispatches contact hooks, and moves nothing.
 *
 * Swap the import for `@scenoco-three/rapier` and the same scene gains real dynamics with no
 * other change. That is the whole point of the shared names.
 */
export class RigidBody extends Component {
  /** How the body would move. Inert here. */
  kind: RigidBodyKind = 'dynamic';
  /** Multiplier on world gravity. Inert here. */
  gravityScale = 1;
}
