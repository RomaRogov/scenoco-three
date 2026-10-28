# @scenoco-three/box2d

2D physics on [planck](https://piqnt.com/planck.js/) (a pure-JS Box2D port), in Unity's shape. Part
of [SceNoCo](https://github.com/RomaRogov/scenoco-three). Nothing to await: it is plain JavaScript.

```tsx
const bouncy = new PhysicsMaterial2D({ friction: 0, bounciness: 1 });

<Mesh position={[0, 5, 0]}>
  <CircleGeometry args={[0.3]} />
  <Rigidbody2D collisionDetectionMode={CollisionDetectionMode2D.Continuous} />
  <CircleCollider2D material={bouncy} />   {/* radius left out: the mesh's */}
  <Ball />
</Mesh>
<Group position={[0, -0.6, 0]}>
  <BoxCollider2D size={[19.5, 0.5]} isTrigger />   {/* no Rigidbody2D: static, as in Unity */}
</Group>
```

- The simulation runs in the **XY plane**: a body drives its node's x, y and `rotation.z`; z is left
  for depth. Angles are **degrees**, as in Unity's 2D physics.
- `Rigidbody2D` — `bodyType` (`RigidbodyType2D.Dynamic`, `Kinematic`, `Static`), `mass` (1, whatever
  the colliders' size, unless `useAutoMass`), `gravityScale`, `linearDamping`, `angularDamping`,
  `constraints` (`RigidbodyConstraints2D.FreezePositionX | RigidbodyConstraints2D.FreezeRotation`, …),
  `freezeRotation`, `collisionDetectionMode`; `linearVelocity`, `angularVelocity`, `position`,
  `rotation`; `addForce(v, ForceMode2D.Impulse)`, `addForceAtPosition`, `addTorque`, `movePosition`,
  `moveRotation`, `sleep`, `wakeUp`. A change to any setting applies at once. A dynamic body moves
  its node; a kinematic one follows its node or `movePosition`, pushing what is in its way.
- `BoxCollider2D` (`size`), `CircleCollider2D` (`radius`), `CapsuleCollider2D` (`size`, `direction`),
  `PolygonCollider2D` (`points`, concave too) and `EdgeCollider2D` (`points`), each with `offset`,
  `isTrigger`, `friction`, `bounciness`, `material`, `density`, `layer`. A size left out fits the
  meshes on and under the node; sizes scale with the node, and follow it when it is scaled.
- A collider with no `Rigidbody2D` is static and follows its node when moved; colliders on nodes
  under a `Rigidbody2D` are part of it — one compound body, as in Unity.
- `PhysicsMaterial2D` — a surface colliders share through `material={ice}`: `friction`, `bounciness`.
- Contact messages on any behaviour of the collider's node and its body's:
  `onCollisionEnter2D/Stay2D/Exit2D(collision)` — `collision.node`, `.contacts`,
  `.relativeVelocity` — and `onTriggerEnter2D/Stay2D/Exit2D(other)`. Destroying in a handler is safe.
- Unity's queries: `Physics2D.raycast(origin, direction)` returning a `RaycastHit2D` or null,
  `raycastAll`, `overlapPoint`, `overlapCircle(All)`, `overlapBox(All)`, each taking a `layerMask`
  (`1 << layer`); `Physics2D.queriesHitTriggers`, `queriesStartInColliders`.
- `Physics2D.ignoreLayerCollision(a, b)` has two layers (0 to 15) pass through each other.
- `Physics2D.gravity` sets gravity. Everything else is planck's, used as planck documents it:
  `Physics2D.world` is its world, `rb.planckBody` and `collider.planckFixtures` its objects.
