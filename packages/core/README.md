# @scenoco-three/core

Unity's behaviours on [three.js](https://threejs.org), with scenes written in TSX and no React.
Part of [SceNoCo](https://github.com/RomaRogov/scenoco-three).

```bash
npm create @scenoco-three my-game      # a new game that runs, with the rules card as its AGENTS.md
```

Or into an existing project:

```bash
npm install @scenoco-three/core three
npm install -D @scenoco-three/tools vite
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
    <PerspectiveCamera position={[0, 2, 5]} rotation={[-0.4, 0, 0]} />
    <DirectionalLight position={[3, 8, 5]} intensity={2} />
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
- `simulate(Main)` runs a scene with no canvas, for a Vitest test in Node or jsdom: it steps frames,
  presses keys and waits for a condition, so the game's rules are tested like any other code.
- In development `play()` installs `window.__scenoco`, the bridge a browser tool or
  a Playwright test drives the game through, and every object
  remembers where its tag was written (`sourceOf`). A button on the page opens
  [the editor](../editor) over the running game.

Inside a React app — or any page the game is one part of — it goes in an element, and `dispose()`
takes it out again; the plugin's `include` keeps the app's own TSX React's:

```tsx
// vite.config.ts: plugins: [react({ exclude: /src\/game\// }), scenoco({ include: 'src/game/**' })]
function Game() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const game = play(Main, { container: host.current! });   // Main is in src/game/
    return () => game.dispose();
  }, []);
  return <div ref={host} style={{ height: 400 }} />;
}
```

## The packages

Every package depends on core alone; install the ones a game needs.

| Package | What it adds |
|---|---|
| [`@scenoco-three/rapier`](https://www.npmjs.com/package/@scenoco-three/rapier) | 3D physics on Rapier: `Rigidbody`, the colliders, `CharacterController`, joints, `Physics.raycast`, `onCollisionEnter` / `onTriggerEnter`. |
| [`@scenoco-three/box2d`](https://www.npmjs.com/package/@scenoco-three/box2d) | 2D physics on planck: `Rigidbody2D`, the 2D colliders, Unity's nine 2D joints, `Physics2D.raycast`, `onCollisionEnter2D`. |
| [`@scenoco-three/particles`](https://www.npmjs.com/package/@scenoco-three/particles) | Unity's `ParticleSystem` on three.quarks. |
| [`@scenoco-three/audio`](https://www.npmjs.com/package/@scenoco-three/audio) | Unity's `AudioSource`, `AudioClip` and `AudioMixer` on three.js's Web Audio. |
| [`@scenoco-three/splines`](https://www.npmjs.com/package/@scenoco-three/splines) | Unity's Splines — tracks, rails and roads: `SplineContainer`, `SplineMesh`, `SplineExtrude`, `SplineInstantiate`, `SplineAnimate`. |
| [`@scenoco-three/terrain`](https://www.npmjs.com/package/@scenoco-three/terrain) | Unity's `Terrain` and `TerrainData`: ground from a heightmap, layers blended by weight. |
| [`@scenoco-three/tools`](https://www.npmjs.com/package/@scenoco-three/tools) | `scenoco check` — a scene only declares — and the `scenoco()` Vite plugin. |
| [`@scenoco-three/editor`](https://www.npmjs.com/package/@scenoco-three/editor) | A visual editor over the running game in development, writing edits back into the `.tsx` files. |
| [`@scenoco-three/unity`](https://www.npmjs.com/package/@scenoco-three/unity) | `scenoco-unity`: the game's prefabs, scenes, meshes and materials written into a Unity project. |
| [`@scenoco-three/create`](https://www.npmjs.com/package/@scenoco-three/create) | The starter `npm create @scenoco-three` copies. |

**Every signature is in [API.md](API.md)** — one page, test-enforced to name every export.
How the pieces fit — scenes, behaviours, refs, prefabs, assets, physics, the other packages — is the
rules card a model reads, shipped beside this README: point an agent at
`node_modules/@scenoco-three/core/AGENTS.md`. A project `npm create @scenoco-three` makes has it as its
own `AGENTS.md` ([the card](https://github.com/RomaRogov/scenoco-three/blob/main/packages/create/template/AGENTS.md)).
