# @scenoco-three/vite

The [Vite](https://vite.dev) plugin for [SceNoCo](https://github.com/): import a scene XML
file and get a compiled bundle, with exactly the component and node modules that scene uses
imported alongside it — nothing more.

```ts
// vite.config.ts
import { bundlePlugin } from '@scenoco-three/vite';
export default defineConfig({
  plugins: [bundlePlugin({ componentRoots: ['src/components'] })],
});
```

```ts
import sceneBundle from './scenes/level.scene.xml?bundle'; // compiled in Node
engine.loadScene(sceneBundle);
```

The scene is validated and compiled in Node (via `@scenoco-three/compiler`); the browser
receives the bundle data plus usage-based imports of the components/tags it needs (including
those used by embedded prefabs). No XML parser, validator, or compiler reaches the browser.

`vite` is a peer dependency. See the [repository](../../README.md).

## License

[MIT](./LICENSE)
