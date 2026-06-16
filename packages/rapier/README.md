# @scenoco-three/rapier

Optional [Rapier](https://rapier.rs) physics for [SceNoCo](https://github.com/): a
`<Physics>` scene setting plus `<RigidBody>` / `<Collider>` components, built entirely on the
public `System` seam in `@scenoco-three/core`. Import it to get physics; don't, and no
physics (or Rapier WASM) ships.

```ts
import { initRapier } from '@scenoco-three/rapier'; // registers the tags + system
await initRapier();        // load the WASM once, before loadScene
engine.loadScene(bundle);  // a scene that declares <Physics>/<RigidBody>/<Collider>
```

```xml
<Scene>
  <Physics gravity="0 -9.81 0" />
  <Mesh position="0 5 0"><BoxGeometry /><MeshStandardMaterial />
    <Components><RigidBody /><Collider /></Components>
  </Mesh>
</Scene>
```

This package is the reference example that the framework's add-on seams work: a
`@system(RigidBody)` reconciles a Rapier world from the live component set, with
`@dimforge/rapier3d-compat` isolated here and core staying physics-free.

`three` is a peer dependency. See the [repository](../../README.md) and
[docs/physics-plan.md](../../docs/physics-plan.md).

## License

[MIT](./LICENSE)
