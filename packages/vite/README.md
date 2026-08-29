# @scenoco-three/vite

The [Vite](https://vite.dev) plugin for [SceNoCo](https://github.com/): import a scene XML
file and get a compiled bundle, with exactly the component and node modules that scene uses
imported alongside it — nothing more.

```bash
npm i -D @scenoco-three/vite
```

## Setup

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { bundlePlugin } from '@scenoco-three/vite';

export default defineConfig({
  // Zero-config: compiles every document under assets/, and picks up the tag
  // vocabulary of each @scenoco-three/* package in your package.json.
  plugins: [bundlePlugin()],
});
```

```ts
// app.ts
import sceneBundle from '../assets/scenes/level.scene.xml?bundle';   // compiled in Node
import prefab from '../assets/scenes/brick.prefab.xml?bundle';        // .prefab.xml → a prefab bundle
engine.loadScene(sceneBundle);
```

A TypeScript declaration for the `?bundle` suffix (drop in `vite-env.d.ts`):

```ts
declare module '*.xml?bundle' {
  import type { Bundle } from '@scenoco-three/core';
  const bundle: Bundle;
  export default bundle;
}
```

## Options

```ts
interface BundlePluginOptions {
  componentRoots?: string[];    // default ['assets'] — dirs scanned for tag/component modules
  registerPackages?: string[];  // tag packages; default: @scenoco-three/* deps from package.json
}
```

## What it does

For `import x from './s.scene.xml?bundle'`, in Node at build/serve time:

1. **Discovers** your components (`loadComponents`) and registers them so the validator has
   the full vocabulary, mapping each tag → the file that defines it.
2. **Validates + compiles** the scene (`compileSceneXml`) — a `file:line:col` error fails the
   build. `.prefab.xml` compiles to a standalone prefab bundle for `engine.instantiate`.
3. Emits the bundle **plus usage-based imports** of exactly the modules the scene (and any
   embedded prefab) uses:

```ts
// generated module for level.scene.xml?bundle
import '/abs/assets/components/Rotator.ts';   // ← used by this scene
import '@scenoco-three/core/nodes/Mesh';   // ← built-in tag it uses
export default [1, [/* strings */], [/* assets */]];
```

So loading a scene auto-registers its components (decorator side effect), unused tags (and
their three.js classes) never ship, and **no XML parser, validator, or compiler reaches the
browser**. Edits to a watched component or `src=` resource trigger a recompile in dev.

## Standalone & dependencies

Depends on `@scenoco-three/compiler` (which pulls in `core`); `vite` is a **peer**. This
package is purely the build-time glue between the two — the optional convenience layer for a
Vite app. You don't need it: any bundler (or a plain `scenoco bundle` step) can produce the
same bundle JSON for `engine.loadScene(...)`. The `@scenoco-three/editor` package builds on
this plugin to serve scenes the same way production does.

See the [repository](../../README.md).

## License

[MIT](./LICENSE)
