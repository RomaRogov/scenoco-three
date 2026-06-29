# @scenoco-three/rapier

Optional **3D physics** for [SceNoCo](https://github.com/) on [Rapier](https://rapier.rs): a
`<Physics>` scene setting plus `<RigidBody>` and per-shape `*Collider` components, built
entirely on the public `System` seam in `@scenoco-three/core`. Import it to get physics;
don't, and no physics (or Rapier WASM) ships. The 2D counterpart is
[`@scenoco-three/box2d`](../box2d).

```bash
npm i @scenoco-three/rapier
```

## Usage

Rapier is WASM — load it **once** before loading any scene that uses `<Physics>`:

```ts
import { initRapier } from '@scenoco-three/rapier'; // importing registers the tags
await initRapier();        // idempotent; builds the WASM
engine.loadScene(bundle);  // a scene that declares <Physics>/<RigidBody>/<Collider>
```

For the compiler/Vite plugin to validate the tags, register the package:

```ts
bundlePlugin({ registerPackages: ['@scenoco-three/rapier'] });
// or CLI: scenoco validate scene.xml --components src   (package imported by the scene)
```

```xml
<Scene>
  <Physics gravity="0 -9.81 0" />
  <Mesh position="0 5 0">
    <BoxGeometry /><MeshStandardMaterial />
    <Components>
      <RigidBody kind="dynamic" />
      <BoxCollider halfExtents="0.5 0.5 0.5" restitution="0.4" />
    </Components>
  </Mesh>
  <Mesh position="0 0 0">
    <BoxGeometry width="20" height="0.5" depth="20" /><MeshStandardMaterial />
    <Components><RigidBody kind="fixed" /><BoxCollider halfExtents="10 0.25 10" /></Components>
  </Mesh>
</Scene>
```

## Tags

### `<Physics>` — scene setting (on `<Scene>`)

| Attr | Type | Default | |
| --- | --- | --- | --- |
| `gravity` | `vec3` | `0 -9.81 0` | World gravity vector. |

### `<RigidBody>` — component

| Attr | Type | Default | |
| --- | --- | --- | --- |
| `kind` | `dynamic \| fixed \| kinematic` | `dynamic` | How the body moves. |
| `linearDamping` | `float` | `0` | |
| `angularDamping` | `float` | `0` | |
| `gravityScale` | `float` | `1` | Multiplier on world gravity for this body. |

### Colliders — one tag per shape (each a component; attaches to the node's `RigidBody`)

Shared on every collider: `restitution` (float `0`, bounciness 0..1), `friction` (float
`0.5`), `density` (float `1`, kg/m³), `isSensor` (bool `false` — a trigger: reports overlaps
with no collision response).

| Tag | Shape attrs |
| --- | --- |
| `<BoxCollider>` | `halfExtents` vec3 `0.5 0.5 0.5` |
| `<SphereCollider>` | `radius` float `0.5` |
| `<CapsuleCollider>` | `radius` float `0.5`, `halfHeight` float `0.5` (along Y) |
| `<CylinderCollider>` | `radius` float `0.5`, `halfHeight` float `0.5` (along Y) |
| `<PlaneCollider>` | `halfExtents` vec2 `5 5` (X and Z) |

### `<Joint>` — component

Connects this node's `<RigidBody>` to another body's with a Rapier impulse joint.

| Attr | Type | Default | |
| --- | --- | --- | --- |
| `kind` | `fixed \| revolute \| spherical \| prismatic \| spring` | `fixed` | Joint type. |
| `connectedBody` | node ref | — | The other node (must have a `<RigidBody>`). |
| `anchor` | vec3 | `0 0 0` | Local anchor on this body. |
| `connectedAnchor` | vec3 | `0 0 0` | Local anchor on the connected body. |
| `axis` | vec3 | `0 1 0` | Hinge/slide axis (revolute, prismatic). |
| `stiffness` / `damping` / `restLength` | float | `1` / `0.5` / `0` | Spring joint params. |

```xml
<Mesh id="hinge"><BoxGeometry /><Components><RigidBody kind="fixed" /><BoxCollider /></Components></Mesh>
<Mesh id="door" position="1 0 0">
  <BoxGeometry width="2" /><MeshStandardMaterial />
  <Components>
    <RigidBody /><BoxCollider halfExtents="1 0.5 0.1" />
    <Joint kind="revolute" connectedBody="#hinge" anchor="-1 0 0" axis="0 1 0" />
  </Components>
</Mesh>
```

## Collision hooks (Unity-style)

Contacts are delivered to **components** via duck-typed hooks — implement any of (no `2D`
suffix, the 3D analogue of the box2d hooks):

```ts
onCollisionEnter(other: Object3D): void   // solid touch began
onCollisionExit(other: Object3D): void
onTriggerEnter(other: Object3D): void     // sensor (isSensor) overlap began
onTriggerExit(other: Object3D): void
```

Events are enabled on every collider automatically. They are collected from Rapier's event
queue during the step and dispatched **after** it returns, so a hook may safely destroy a node
(or any scene object) without corrupting the in-progress simulation.

```ts
@component({ name: 'Coin' })
export class Coin extends Component {
  onTriggerEnter(other: Object3D) {
    if (this.engine.getComponents(other).some((c) => c instanceof Player)) this.engine.destroy(this.node);
  }
}
```

## How it works (the `System` seam)

A `@system(RigidBody)` (`PhysicsSystem`) reconciles a Rapier `World` from the live component
set: it creates/destroys bodies and colliders as components appear/disappear, steps the world
in `fixedStep`, and writes each body's transform back to its `Object3D`. Config comes from the
`<Physics>` attachment, read via `engine.findAttachment(Physics)`. `@dimforge/rapier3d-compat`
is isolated here; **core stays physics-free**. This package is the reference example that the
framework's add-on seams work.

**Exports:** `initRapier`, `sceneTags`, `PhysicsSystem`, `RigidBody`, `Physics`, `Collider`
(abstract base), and each `*Collider` class.

## Standalone & dependencies

Depends on `@scenoco-three/core` and `@dimforge/rapier3d-compat` (Rapier WASM); `three` is a
**peer**. It plugs in entirely through core's public `System` seam — **core has no idea it
exists** — so importing this package is the only thing that adds 3D physics (and its WASM) to
a build. Drop the import and nothing physics-related ships.

See the [repository](../../README.md) and [docs/physics-plan.md](../../docs/physics-plan.md).

## License

[MIT](./LICENSE)
