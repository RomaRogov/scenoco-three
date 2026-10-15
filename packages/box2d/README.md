# @scenoco-three/box2d

2D physics on [planck](https://piqnt.com/planck.js/) (a pure-JS Box2D port), in Unity's shape. Part
of [SceNoCo](https://github.com/RomaRogov/scenoco-three). Nothing to await: it is plain JavaScript.

```tsx
<Mesh position={[0, 5, 0]}>
  <SphereGeometry args={[0.3]} />
  <Rigidbody2D bullet />
  <CircleCollider2D radius={0.3} restitution={1} />
  <Ball />
</Mesh>
<Group position={[0, -0.6, 0]}>
  <Rigidbody2D bodyType="static" />
  <BoxCollider2D halfExtents={[9.75, 0.25]} isSensor />
</Group>
```

- The simulation runs in the **XY plane**: a body drives its node's x, y and `rotation.z`; z is left
  for depth.
- `Rigidbody2D` — `bodyType` (`'dynamic'`, `'kinematic'`, `'static'`), damping, `fixedRotation`,
  `gravityScale`, `bullet`; `setVelocity`, `getVelocity`, `applyImpulse`, `setPosition`.
- `BoxCollider2D`, `CircleCollider2D`, `CapsuleCollider2D`, `EdgeCollider2D`, `PolygonCollider2D`,
  `ChainCollider2D`, each with `density`, `friction`, `restitution`, `isSensor`.
- Contact messages on any behaviour of either node, given the other node:
  `onCollisionEnter2D/Exit2D`, `onTriggerEnter2D/Exit2D`.
- `Physics2D.gravity` is the world's gravity (`Physics2D.gravity.set(0, 0)` for none).
