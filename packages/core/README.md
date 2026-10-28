# @scenoco-three/core

Unity's behaviours on [three.js](https://threejs.org), with scenes written in TSX and no React.
Part of [SceNoCo](https://github.com/RomaRogov/scenoco-three).

```bash
npm install @scenoco-three/core three
```

```ts
// vite.config.ts — TSX through core's own JSX runtime (and the editor's endpoints while serving)
export default defineConfig({ plugins: [scenoco()] });   // from '@scenoco-three/tools/vite'
// tsconfig.json: "jsx": "react-jsx", "jsxImportSource": "@scenoco-three/core"
```

```tsx
export class Spinner extends Behaviour<Mesh> {
  speed = 1;
  update(dt: number) {
    this.node.rotation.y += this.speed * dt;
  }
}

export const Main = () => (
  <Scene>
    <PerspectiveCamera position={[0, 2, 5]} />
    <Mesh>
      <BoxGeometry />
      <MeshStandardMaterial color="orange" />
      <Spinner speed={2} />
    </Mesh>
  </Scene>
);

play(Main);
```

- A tag is the three.js class you import; attributes follow React Three Fiber's rules (`args`,
  `set`/`copy`, dashed paths, `attach`). TSX builds the objects once — there is no reconciler.
- A `Behaviour` has Unity's lifecycle and lookups; a prefab is `prefab(() => …)` and `instantiate`
  calls it; `SceneManager.load(Level2)` swaps scenes and `dontDestroyOnLoad` keeps what outlives them.
- `Time`, `Input` (named axes, and `<button data-button="Pause">` as a virtual button), coroutines
  with Unity's yield instructions, typed `Event`s, `Mathf`, a seeded `Random` and `PlayerPrefs`.
- The scene's first visible camera draws it — a scene puts its camera and lights in, as in Unity;
  hiding it hands over to the next. A node with
  `attach` is both a child and that property: `<Object3D attach="target" />` is where a light shines.
- In development `play()` installs `window.__scenoco`, the bridge a browser tool or
  `@scenoco-three/observer` drives the game through, and every object
  remembers where its tag was written (`sourceOf`). A button on the page opens
  [the editor](../editor) over the running game.

**Every signature is in [API.md](API.md)** — one page, test-enforced to name every export.
