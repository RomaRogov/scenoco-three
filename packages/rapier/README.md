# @scenoco-three/rapier

3D physics on [Rapier](https://rapier.rs), in Unity's shape. Part of
[SceNoCo](https://github.com/RomaRogov/scenoco-three).

```tsx
await initRapier(); // WebAssembly: once, before the first scene with physics

<Mesh position={[0, 5, 0]}>
  <SphereGeometry args={[0.5]} />
  <Rigidbody />
  <SphereCollider radius={0.5} material={rubber} />   {/* new PhysicsMaterial({ bounciness: 0.6 }) */}
  <Ball />
</Mesh>
<Mesh position={[0, -0.5, 0]}>
  <BoxGeometry args={[40, 1, 10]} />
  <BoxCollider size={[40, 1, 10]} />   {/* no Rigidbody: static, as in Unity */}
</Mesh>
```

- `Rigidbody` — `isKinematic`, `useGravity`, `constraints`
  (`RigidbodyConstraints.FreezeRotationX | RigidbodyConstraints.FreezeRotationY`, …), `freezeRotation`,
  damping, `velocity`, `angularVelocity`, `maxAngularVelocity`, `mass`; `addForce(v, ForceMode.Impulse)`,
  `addTorque`, `movePosition`, `moveRotation`. A change to any setting applies at once, as in Unity. A
  dynamic body moves its node; a kinematic one follows its node.
- Colliders on nodes under a `Rigidbody` are part of it — one compound body, as in Unity; they move
  with their nodes, and contacts are heard on the collider's node and the body's.
- `BoxCollider` (`size`), `SphereCollider` (`radius`), `CapsuleCollider` (`radius`, `height`),
  `MeshCollider` (the meshes under its node, or `sharedMesh`; `convex` for a moving body) and `TerrainCollider` (a
  `@scenoco-three/terrain` `TerrainData`'s ground), each with `isTrigger`, `center`, `friction`,
  `bounciness`, `density`, `layer`. Sizes scale with the node, and follow it when it is scaled.
- `PhysicsMaterial` — a surface colliders share through `material={ice}`, with `friction`,
  `bounciness` and Unity's combine modes (`PhysicsMaterialCombine.Minimum`, …). A change to it, or to
  a collider's own `friction`, applies at once.
- Contact messages on any behaviour of either node: `onCollisionEnter/Stay/Exit(collision)`,
  `onTriggerEnter/Stay/Exit(other)`; `collision.impulse` says how hard a hit was, `collision.contacts`
  where they touch. Triggers fire for kinematic bodies against static triggers, as in Unity.
  Destroying in a handler is safe.
- Unity's queries: `Physics.raycast(origin, direction)` or `(ray)` — three's `Raycaster.setFromCamera`
  makes one through the pointer — returning a `RaycastHit` or null; `raycastAll`, `sphereCast`,
  `overlapSphere`, `overlapBox`, `checkSphere`. Each takes `maxDistance`, a `layerMask`
  (`1 << layer`) and `QueryTriggerInteraction`.
- `CharacterController` — `move(motion)`, `simpleMove(speed)`, `isGrounded`, `slopeLimit`,
  `stepOffset`; what it bumps into arrives as `onControllerColliderHit(hit)`.
- `FixedJoint`, `HingeJoint` (`axis`, `useLimits`/`limits`, `useMotor`/`motor`) and `SpringJoint`,
  on a node with a `Rigidbody`, to `connectedBody` or the world.
- `Physics.ignoreLayerCollision(a, b)` has two layers (0 to 15) pass through each other.
- `Physics.gravity` sets gravity. Everything else is Rapier's, used as Rapier documents it:
  `Physics.world` is its world, `rb.rapierBody`, `collider.rapierCollider` and `joint.rapierJoint` its
  objects.
