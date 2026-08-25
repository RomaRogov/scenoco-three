/**
 * `@scenoco-three/rapier` — 3D physics for SceNoCo, on Rapier.
 *
 * ```ts
 * import { initRapier } from '@scenoco-three/rapier';
 *
 * await initRapier();              // Rapier is WebAssembly; this loads it
 * await SceneManager.load(Level);
 * ```
 *
 * ```xml
 * <Scene>
 *   <Systems>
 *     <Physics gravity="x: 0; y: -9.81; z: 0" />
 *   </Systems>
 *
 *   <Mesh id="ball" geometry="…" material="…" position="y: 5">
 *     <Components>
 *       <RigidBody kind="dynamic" ccd="true" />
 *       <SphereCollider radius="0.5" restitution="0.6" />
 *     </Components>
 *   </Mesh>
 * </Scene>
 * ```
 *
 * Contacts arrive as typed hooks on any component — `onCollisionEnter`, `onCollisionExit`,
 * `onTriggerEnter`, `onTriggerExit` — each taking the other node.
 *
 * `@scenoco-three/collision` exports the same tags and the same hooks with no dynamics, so a
 * project can swap the import. Because the names are shared, depending on **both** is a build
 * error: a project picks one back-end.
 */
import RAPIER from '@dimforge/rapier3d-compat';

// Side effect: merges the contact hooks onto `Component`.
import './contacts.js';

export { Physics } from './Physics.js';
export { RigidBody, type RigidBodyKind } from './RigidBody.js';
export { type ContactHandlers } from './contacts.js';

export { Collider } from './Collider.js';
export { BoxCollider } from './BoxCollider.js';
export { SphereCollider } from './SphereCollider.js';
export { CapsuleCollider } from './CapsuleCollider.js';
export { CylinderCollider } from './CylinderCollider.js';
export { PlaneCollider } from './PlaneCollider.js';

let started: Promise<void> | undefined;

/**
 * Load Rapier's WebAssembly. Await it once, before the first scene that uses physics.
 *
 * Calling it again returns the same promise, so a scene that is not sure whether the app
 * already did can simply await it.
 */
export function initRapier(): Promise<void> {
  return (started ??= RAPIER.init());
}
