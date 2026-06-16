# @scenoco-three/core

The **runtime** of [SceNoCo](https://github.com/) — a component-based scene framework for
[Three.js](https://threejs.org). Scene · Node · Component, Unity/Cocos-shaped, with the
scene compiled to a compact bundle the runtime loads. **No XML parser or validator ships
here** — that lives in `@scenoco-three/compiler` (build time only).

```ts
import { Engine, Component, component, property } from '@scenoco-three/core';
import sceneBundle from './scene.bundle.json'; // produced at build time

@component({ name: 'Rotator', description: 'Spins the host around Y' })
export class Rotator extends Component {
  @property({ type: 'float', default: 1 }) speed = 1;
  override update(dt: number) { this.node.rotation.y += this.speed * dt; }
}

const engine = new Engine({ canvas });
engine.loadScene(sceneBundle);
```

## What's in here

- `Engine` — owns the `THREE.Scene`, the render loop, component lifecycles, the `System`
  seam, prefab instantiation, and the bundle deserializer.
- `Component` — typed host nodes, typed `@property` references, lifecycle hooks.
- `PrefabRef` — what a `@property({ type: 'prefab' })` field receives; `spawn()` instantiates
  a build-time-embedded prefab.
- The extensible node/attachment registry and the bundle wire format.

`three` is a peer dependency. See the [repository](../../README.md) and
[ARCHITECTURE.md](../../ARCHITECTURE.md) for the full design.

## License

[MIT](./LICENSE)
