# @scenoco-three/box2d

**2D physics** for [SceNoCo](https://github.com/) on [planck](https://piqnt.com/planck.js)
(a pure-JS [Box2D](https://box2d.org) port): a `<Physics2D>` scene setting plus
`<RigidBody2D>` / `<Collider2D>` components, built entirely on the public `System` seam in
`@scenoco-three/core`. Import it for 2D physics; don't, and none ships. The 3D counterpart is
[`@scenoco-three/rapier`](../rapier).

Unlike the Rapier add-on, **no async init** — planck is pure JS, so import and load directly.

```ts
import '@scenoco-three/box2d'; // registers the tags (side effect)
engine.loadScene(bundle);       // a scene with <Physics2D>/<RigidBody2D>/<Collider2D>
```

```xml
<Scene>
  <Physics2D gravity="0 -9.81" />
  <Mesh id="ball" position="0 6 0">
    <SphereGeometry radius="0.3" />
    <Components>
      <RigidBody2D bullet="true" />          <!-- continuous collision for a fast ball -->
      <Collider2D restitution="0.9" />        <!-- bouncy circle, auto-sized from the geometry -->
    </Components>
  </Mesh>
  <Mesh id="paddle" position="0 0.5 0">
    <BoxGeometry width="3" height="0.4" depth="0.5" />
    <Components>
      <RigidBody2D kind="kinematic" />        <!-- you move the node; the body follows -->
      <Collider2D shape="box" halfExtents="1.5 0.2" />
    </Components>
  </Mesh>
</Scene>
```

The simulation runs in the **XY plane**: a body's position drives the node's `x`/`y`, its
angle drives `rotation.z`. Contacts are delivered to components via duck-typed, **Unity-style
hooks** — implement any of:

```ts
onCollisionEnter2D(other: Object3D): void   // solid touch began
onCollisionExit2D(other: Object3D): void
onTriggerEnter2D(other: Object3D): void     // sensor (isSensor) overlap began
onTriggerExit2D(other: Object3D): void
```

Contacts are queued during the step and dispatched after it, so a hook may safely destroy a
brick (or any scene object) without corrupting the in-progress simulation.

`three` is a peer dependency. See the [repository](../../README.md) and
[ARCHITECTURE.md](../../ARCHITECTURE.md) (`System` seam).

## License

[MIT](./LICENSE)
