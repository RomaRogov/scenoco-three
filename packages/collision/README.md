# @scenoco-three/collision

Lightweight, **detection-only** collision for [SceNoCo](https://github.com/) — with an API
**identical to [`@scenoco-three/rapier`](../rapier)** so switching engines is just swapping the
import. The same `<RigidBody>`/`<BoxCollider>` scene and the same `onCollisionEnter` /
`onTriggerEnter` component code run on either package. This one **detects overlaps and dispatches
the contact hooks; it has no dynamics** (bodies and gravity are inert). Zero dependencies.

```bash
npm i @scenoco-three/collision
```

> **Pick one engine.** The tags share rapier's names on purpose, so importing both packages throws a
> duplicate-registration error — a project commits to one backend, the way Cocos Creator selects a
> physics engine. Use **collision** for cheap overlap without a physics dep; use **rapier** for real
> forces, resolution, and joints.

## Colliders (same as rapier)

Every collider carries `isSensor` (bool) plus `restitution` / `friction` / `density` (accepted for
rapier compatibility, **inert** here):

| Tag | Attributes |
| --- | --- |
| `<BoxCollider>` | `halfExtents` (vec3, `0.5 0.5 0.5`) |
| `<SphereCollider>` | `radius` (float, `0.5`) |
| `<CapsuleCollider>` | `radius` (`0.5`), `halfHeight` (`0.5`, along Y) |
| `<CylinderCollider>` | `radius` (`0.5`), `halfHeight` (`0.5`, along Y) |
| `<PlaneCollider>` | `halfExtents` (vec2, `5 5`) — flat XZ, thin cuboid |

`<RigidBody>` (kind / linearDamping / angularDamping / gravityScale / ccd) and `<Physics gravity>`
are also registered so a **rapier scene drops in unchanged** — but they are **inert**: nothing moves,
there is no simulation. Colliders detect overlaps with or without a `<RigidBody>`; move nodes yourself
(or with your own components).

- **Approximations** (detection-only): boxes/planes are axis-aligned in scale (box rotation ignored);
  a **cylinder is approximated as a capsule**. Internally every shape is an AABB box or a swept-sphere
  capsule, so all pairs use three exact tests (box–box, capsule–capsule, box–capsule).

## Events (same hooks rapier dispatches)

Any component on a collider's node may implement these — a solid pair fires the `onCollision*` pair,
a **sensor** pair (either collider `isSensor`) fires `onTrigger*`. Each receives the **other** node:

```ts
import { Component, component } from '@scenoco-three/core';
import type { Object3D } from 'three';

@component({ name: 'Bullet', description: 'Despawns on impact' })
export class Bullet extends Component {
  onCollisionEnter(other: Object3D): void {
    this.engine.destroy(other); // hit something solid
    this.engine.destroy(this.node);
  }
  onTriggerEnter(_other: Object3D): void {}
}
```

`onCollisionExit` / `onTriggerExit` fire the frame an overlap ends, and on the **surviving** collider
when the other is destroyed mid-overlap. This is byte-for-byte the rapier contact API, so behaviour
code moves between the two engines with no changes.

## Scene (a rapier scene, unchanged)

```xml
<Scene>
  <Physics gravity="0 -9.81 0" />               <!-- inert here; kept for drop-in -->
  <Mesh id="player"><BoxGeometry />
    <Components><RigidBody /><BoxCollider halfExtents="0.5 1 0.5" /></Components>
  </Mesh>
</Scene>
```

The `CollisionSystem` **auto-runs** while the scene (or a spawned prefab) holds any collider — no
manual registration — and stops on scene unload. It runs on core's `System` seam via
`@system(Collider)`, exactly like the physics add-ons.

## License

[MIT](./LICENSE)
