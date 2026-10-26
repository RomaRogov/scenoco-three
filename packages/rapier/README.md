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

- `Rigidbody` — `isKinematic`, `useGravity`, `freezeRotation`, damping, `velocity`,
  `angularVelocity`, `maxAngularVelocity`, `mass`; `addForce(v, ForceMode.Impulse)`, `addTorque`,
  `movePosition`, `moveRotation`. A dynamic body moves its node; a kinematic one follows its node.
- `BoxCollider` (`size`), `SphereCollider` (`radius`), `CapsuleCollider` (`radius`, `height`),
  `MeshCollider` (the meshes under its node, or `sharedMesh`; `convex` for a moving body) and `TerrainCollider` (a
  `@scenoco-three/terrain` `TerrainData`'s ground), each with `isTrigger`, `center`, `friction`,
  `bounciness`, `density`. Sizes scale with the node.
- `PhysicsMaterial` — a surface colliders share through `material={ice}`, with `friction`,
  `bounciness` and Unity's combine modes (`PhysicsMaterialCombine.Minimum`, …). A change to it, or to
  a collider's own `friction`, applies at once.
- Contact messages on any behaviour of either node: `onCollisionEnter/Exit(collision)`,
  `onTriggerEnter/Exit(other)`; `collision.impulse` says how hard a hit was. Triggers fire for
  kinematic bodies against static triggers, as in Unity. Destroying in a handler is safe.
- `Physics.gravity` sets gravity; `Physics.world` is Rapier's own world — raycasts, joints, the
  character controller — and `rb.rapierBody` / `collider.rapierCollider` its own objects.
