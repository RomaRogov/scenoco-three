import { PhysicsMaterial, PhysicsMaterialCombine } from '@scenoco-three/rapier';

/**
 * The surfaces, made once and shared — Unity's PhysicsMaterial assets. A collider names one with
 * `material={ice}`; a change to one reaches every collider using it.
 */

/** Nothing grips it: whatever touches it slides, as the lower friction of the two wins. */
export const ice = new PhysicsMaterial({ friction: 0, frictionCombine: PhysicsMaterialCombine.Minimum });

/** Almost all of a fall comes back as a bounce, whatever it lands on. */
export const rubber = new PhysicsMaterial({ bounciness: 0.85, bounceCombine: PhysicsMaterialCombine.Maximum });
