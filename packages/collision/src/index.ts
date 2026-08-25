/**
 * `@scenoco-three/collision` — detection-only collision for SceNoCo, with an API **identical to
 * `@scenoco-three/rapier`**.
 *
 * The same `<BoxCollider>` / `<RigidBody>` scene and the same `onCollisionEnter` /
 * `onTriggerEnter` component code run on either: switching back-ends is swapping the import.
 * This one detects overlaps and dispatches the contact hooks and has no dynamics — bodies and
 * gravity are inert. Reach for rapier when you need real physics.
 *
 * ```xml
 * <Scene>
 *   <Systems>
 *     <Collision />
 *   </Systems>
 *
 *   <Mesh id="pickup" geometry="…" material="…">
 *     <Components>
 *       <BoxCollider halfExtents="x: 0.5; y: 0.5; z: 0.5" isSensor="true" />
 *     </Components>
 *   </Mesh>
 * </Scene>
 * ```
 *
 * Declaring `<Collision>` is optional — the first collider calls `requireSystem` and gets one.
 *
 * Because the tags are shared with rapier deliberately, depending on **both** packages is a
 * build error naming the two classes: a project picks one back-end.
 */

// Side effect: merges the contact hooks onto `Component`.
import './contacts.js';

export { Collision } from './Collision.js';
export { RigidBody, type RigidBodyKind } from './RigidBody.js';
export { type ContactHandlers } from './contacts.js';

export { Collider, type Bounds, type BoxBounds, type CapsuleBounds } from './Collider.js';
export { BoxCollider } from './BoxCollider.js';
export { SphereCollider } from './SphereCollider.js';
export { CapsuleCollider } from './CapsuleCollider.js';
export { CylinderCollider } from './CylinderCollider.js';
export { PlaneCollider } from './PlaneCollider.js';
export { overlaps } from './overlap.js';
