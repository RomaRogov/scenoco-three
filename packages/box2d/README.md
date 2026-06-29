# @scenoco-three/box2d

**2D physics** for [SceNoCo](https://github.com/) on [planck](https://piqnt.com/planck.js)
(a pure-JS [Box2D](https://box2d.org) port): a `<Physics2D>` scene setting plus `<RigidBody2D>`
and per-shape `*Collider2D` components, built entirely on the public `System` seam in
`@scenoco-three/core`. Import it for 2D physics; don't, and none ships. The 3D counterpart is
[`@scenoco-three/rapier`](../rapier).

```bash
npm i @scenoco-three/box2d
```

Unlike the Rapier add-on, **no async init** — planck is pure JS, so import and load directly:

```ts
import '@scenoco-three/box2d'; // registers the tags (side effect)
engine.loadScene(bundle);       // a scene with <Physics2D>/<RigidBody2D>/<Collider2D>
```

The simulation runs in the **XY plane**: a body's position drives the node's `x`/`y`, its
angle drives `rotation.z`.

```xml
<Scene>
  <Physics2D gravity="0 -9.81" />
  <Mesh id="ball" position="0 6 0">
    <SphereGeometry radius="0.3" />
    <Components>
      <RigidBody2D bullet="true" />            <!-- continuous collision for a fast ball -->
      <CircleCollider2D radius="0.3" restitution="0.9" />
    </Components>
  </Mesh>
  <Mesh id="paddle" position="0 0.5 0">
    <BoxGeometry width="3" height="0.4" depth="0.5" />
    <Components>
      <RigidBody2D kind="kinematic" />          <!-- you move the node; the body follows -->
      <BoxCollider2D halfExtents="1.5 0.2" />
    </Components>
  </Mesh>
</Scene>
```

## Tags

### `<Physics2D>` — scene setting (on `<Scene>`)

| Attr | Type | Default | |
| --- | --- | --- | --- |
| `gravity` | `vec2` | `0 -9.81` | Gravity in the XY plane. |
| `velocityIterations` | `int` | `8` | Velocity solver iterations per step. |
| `positionIterations` | `int` | `3` | Position solver iterations per step. |

### `<RigidBody2D>` — component

| Attr | Type | Default | |
| --- | --- | --- | --- |
| `kind` | `dynamic \| static \| kinematic` | `dynamic` | How the body moves. |
| `linearDamping` | `float` | `0` | |
| `angularDamping` | `float` | `0` | |
| `fixedRotation` | `bool` | `false` | Lock rotation (common for characters). |
| `gravityScale` | `float` | `1` | Multiplier on world gravity for this body. |
| `bullet` | `bool` | `false` | Continuous collision for fast bodies. |

### Colliders — one tag per shape (each a component)

Shared on every collider: `density` (float `1`, kg/m²; `0` for static), `friction` (float
`0.3`), `restitution` (float `0`), `isSensor` (bool `false` — a trigger: overlaps, no response).

| Tag | Shape attrs |
| --- | --- |
| `<BoxCollider2D>` | `halfExtents` vec2 `0.5 0.5` |
| `<CircleCollider2D>` | `radius` float `0.5` |
| `<CapsuleCollider2D>` | `size` vec2 `0.5 1`, `direction` `vertical \| horizontal` |
| `<PolygonCollider2D>` | `vertices` vec2[] (convex, CCW) — `"[-0.5 -0.5,0.5 -0.5,0.5 0.5,-0.5 0.5]"` |
| `<EdgeCollider2D>` | `start` vec2 `-0.5 0`, `end` vec2 `0.5 0` |
| `<ChainCollider2D>` | `vertices` vec2[] `"[-0.5 0,0.5 0]"`, `loop` bool `false` |

### `<Joint2D>` — component

Connects this node's `<RigidBody2D>` to another body's (Unity `Joint2D`-style props).

| Attr | Type | Default | |
| --- | --- | --- | --- |
| `kind` | `revolute \| distance \| prismatic \| weld \| wheel` | `revolute` | Joint type (Box2D names). |
| `connectedBody` | node ref | — | The other node (must have a `<RigidBody2D>`). |
| `anchor` | vec2 | `0 0` | Local anchor on this body. |
| `connectedAnchor` | vec2 | `0 0` | Local anchor on the connected body (distance joint). |
| `axis` | vec2 | `1 0` | Slide/wheel axis (prismatic, wheel). |
| `frequency` / `damping` | float | `0` / `0.7` | Distance-joint spring (Hz; 0 = rigid). |

```xml
<Mesh id="pivot" position="0 5 0"><BoxGeometry /><Components><RigidBody2D kind="static" /><BoxCollider2D /></Components></Mesh>
<Mesh id="arm" position="2 5 0">
  <BoxGeometry width="4" /><MeshStandardMaterial />
  <Components>
    <RigidBody2D /><BoxCollider2D halfExtents="2 0.2" />
    <Joint2D kind="revolute" connectedBody="#pivot" anchor="-2 0" />
  </Components>
</Mesh>
```

## Collision hooks (Unity-style)

Contacts are delivered to **components** via duck-typed hooks — implement any of:

```ts
onCollisionEnter2D(other: Object3D): void   // solid touch began
onCollisionExit2D(other: Object3D): void
onTriggerEnter2D(other: Object3D): void     // sensor (isSensor) overlap began
onTriggerExit2D(other: Object3D): void
```

Contacts are queued during the step and dispatched after it, so a hook may safely destroy a
brick (or any scene object) without corrupting the in-progress simulation.

```ts
@component({ name: 'Brick' })
export class Brick extends Component {
  onCollisionEnter2D(other: Object3D) {
    if (this.engine.getComponents(other).some((c) => c instanceof Ball)) this.engine.destroy(this.node);
  }
}
```

## How it works

A `@system(RigidBody2D)` (`Physics2DSystem`) reconciles a planck `World` from the live
component set and writes body transforms back to the XY plane of each `Object3D`. `planck` is
isolated here; **core stays physics-free**.

**Exports:** `sceneTags`, `Physics2DSystem`, `RigidBody2D`, `Physics2D`, `Collider2D`
(abstract base), `CapsuleDirection2D`, and each `*Collider2D` class.

## Standalone & dependencies

Depends on `@scenoco-three/core` and `planck` (pure-JS Box2D); `three` is a **peer**. Like the
Rapier add-on it plugs in through core's public `System` seam, so importing it is the only
thing that adds 2D physics — but unlike Rapier there's **no WASM and no async init**. Drop the
import and nothing physics-related ships.

See the [repository](../../README.md) and [ARCHITECTURE.md](../../ARCHITECTURE.md)
(`System` seam).

## License

[MIT](./LICENSE)
