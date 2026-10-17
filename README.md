# SceNoCo

<details>
<summary><i>AI generated description for LLMs and boring people</i></summary>

**Scene · Node · Component** — Unity's behaviours on [three.js](https://threejs.org), with scenes
written in TSX and no React.

```tsx
// game/Spinner.ts — a behaviour: Unity's lifecycle, public fields are its settings
export class Spinner extends Behaviour<Mesh> {
  speed = 1;
  update(dt: number) {
    this.node.rotation.y += this.speed * dt;
  }
}
```

```tsx
// game/Main.tsx — a scene: every tag is the three.js class you import, built at once
export const Main = () => (
  <Scene>
    <PerspectiveCamera position={[0, 2, 5]} />
    <DirectionalLight position={[3, 8, 5]} intensity={2} />
    <Mesh>
      <BoxGeometry />
      <MeshStandardMaterial color="orange" />
      <Spinner speed={2} />
    </Mesh>
  </Scene>
);
```

```ts
// main.ts
play(Main);
```

That is the whole model:

- **A tag is a class you import** and `<Mesh>` is `new Mesh()`. Attributes follow React Three
  Fiber's rules — `args` are constructor arguments, `position={[0, 1, 2]}` goes through the
  property's own `set`, `shadow-mapSize` reaches inside, geometry and material attach to their
  parent. There is no React and no reconciler: TSX builds the objects once.
- **A `Behaviour` is a component**, with Unity's hooks (`awake`, `start`, `update`, `fixedUpdate`,
  `onDestroy`, …), coroutines, `Time`, `Input`, `instantiate`, `destroy`, `findObjectOfType`,
  `SceneManager`.
- **A prefab is a function** returning TSX; `instantiate(Prefab)` calls it.
- **A scene only declares.** Logic lives in behaviours. `scenoco check` refuses loops, branches and
  calls in a `.tsx` file and says what to write instead — which is what keeps a scene editable by a
  tool as well as by hand.
- Everything else is three.js, as three.js documents it — the renderer, post-processing, loaders.

`tsc` checks all of it: a misspelled attribute, a wrong value type, a lowercase tag and a ref of the
wrong class are type errors at the line they were written on.

## Start a project

```bash
npm create @scenoco-three my-game
cd my-game && npm install && npm run dev
```

A block you steer, crates you drop, a camera that follows — every verb a behaviour has, in four short
files — and an `AGENTS.md` that says the whole model in a page, with the observer already in
`.mcp.json` for an agent to look at the running game.

## Packages

| | |
| --- | --- |
| [`@scenoco-three/core`](packages/core) | `Behaviour`, the TSX runtime, `play`, `SceneManager`, `Time`, `Input`, coroutines, events, asset loading. [Its whole API on one page.](packages/core/API.md) |
| [`@scenoco-three/rapier`](packages/rapier) | 3D physics on Rapier, in Unity's shape: `Rigidbody`, `BoxCollider`, `onTriggerEnter`. |
| [`@scenoco-three/box2d`](packages/box2d) | 2D physics on planck: `Rigidbody2D`, `BoxCollider2D`, `onCollisionEnter2D`. |
| [`@scenoco-three/particles`](packages/particles) | Unity's `ParticleSystem` on three.quarks. |
| [`@scenoco-three/audio`](packages/audio) | Unity's `AudioSource` on three.js's Web Audio. |
| [`@scenoco-three/tools`](packages/tools) | `scenoco check` — a scene only declares — and the read/edit layer an editor uses on scene files. |
| [`@scenoco-three/create`](packages/create) | The starter `npm create @scenoco-three` copies. |
| [`@scenoco-three/editor`](packages/editor) | A visual editor that runs on the game's own dev server (`?edit`) and writes edits back into the `.tsx` files byte for byte. |
| [`@scenoco-three/observer`](packages/observer) | An MCP server that runs the game in a headless Chrome and lets an agent hold its clock, drive it and read its behaviours back as text. |

## Editing a scene by hand, visually

```bash
npm run dev            # the game, as always
npx scenoco-editor     # then open the game with ?edit
```

The game's own code builds the scene and holds it still; a tree, an inspector and gizmos edit it,
and each change is written into the `.tsx` file it came from, one attribute at a time, everything
else byte for byte. See [`packages/editor`](packages/editor).

## Examples

- [**Breakout**](examples/breakout) — three levels, Box2D, an HTML HUD, bloom.
- [**Rail Rush**](examples/subway) — a Subway Surfers clone written by Claude Sonnet in one session
  on a fresh starter: 5 minutes, $0.84.

## This repo

```bash
npm install
npm run build          # every package, in dependency order
npm run examples:dev   # examples/breakout
npm test               # vitest, under tests/{core,packages,tooling}
npm run typecheck      # tsc over every package and the tests, then breakout's own check
```

Working *on* this repo with an agent? Start at [`AGENTS.md`](AGENTS.md).

## Status

Pre-1.0, mid-redesign: scenes moved from XML documents to TSX in 0.7, and the editor was rebuilt
on them.

## License

[MIT](LICENSE)

</details>
<br>

*"Scene", "Node" and "Component" combined together to represent the idea. And to book a cool name.*

## What?

>**TL;DR:** it's my approach to marry the traditional web rendering stack with classic game development
patterns.

A lightweight framework for Three.js, which adds a Unity-like component system with an event loop and
TSX scenes. 
TSX represent the scene tree (including components, properties and their relations) in
a simple, text-based form, acceptable for human inspection, git diffs and, most importantly, it makes LLMs fluent in scene description — the weakest part of the modern game slop scene. No
React involved.

Also, there are a lot of game-specific things added for ease of life: unified input, time
measurement with time scale, coroutines done with TypeScript generators, and more!

## Why?

Well, I've been a game developer [for a while already](https://www.linkedin.com/in/romarogov), specialized mostly in mobile and casual games.
And although AI has definitely been interesting to me since I giggled at DeepDream's trippy doggies
in 2015, all this LLM coding hype hit me as suddenly and as hard as it hit you, my dear visitor,
despite the fact that I spend a lot of time on analysis and experiments in that area.

Over the years that I've been watching game generation attempts with LLMs, I was really annoyed by
one problem which still remains: what should we do with the output? Now it's mostly unreadable
garbage, which just takes more and more tokens with every edit, not to mention real development with
human hands.

So, here I am, presenting you my take on the question of how things can be done differently.

## How?

LLMs are fluent in TypeScript, TSX and its concepts, thanks to the huge World Wide Web. They're also
fluent in Unity scripting, just not the scenes — those are mostly a proprietary mess. This framework
gives the model clear associations in all the required areas: no new DSL, no new patterns, just a
mix of the two realities, and it turns out that when all the harness is done right, it does just
what you asked it for without spending all your budget on architectural decisions.

The result can be converted from web to Unity semi-automatically, and vice versa. All logic gets its
place in specific behaviours, which are easy to find and change. You get control of the process back
and can actually see what's happening. Sounds cool, huh?

## The status

I've spent 3 months of my free time with our good old buddy Claude on prototypes, experiments and
tests of different hypotheses. The last implementation was done in two weeks, though, so there can
be bugs, definitely.

But the difference is — this is the first actual codebase I'm actually satisfied with. Yes, I'm
reading all the code produced by AI, still. And you are welcome to inspect it too. I've tried to make
the idea simple, yet used AI to write the actual code — hope it's fine nowadays.

## The harness and the sugar

There are a lot of packages besides `core`, which implements the main idea. You have physics, 2D
(Box2D via planck.js) and 3D (Rapier), done as submodules, but they also add familiar collision
events to components. The particles package helps AI formulate particle design in Shuriken terms and
pass it to three.quarks, the Unity converter prepares meshes, materials, prefabs and scenes
automatically, and so on.

But there are also two really helpful modules there: the observer does all the complex work of
running the simulation and eval in headless Chrome, and the editor lets you view and move objects in
your scene. The editor is still in an early stage, though.

## Why not use R3F and its ecosystem?

[React Three Fiber](https://github.com/pmndrs/react-three-fiber) is great tech, and LLMs know it really well, no doubt. But it's still a framework
for UI, not games. React creates a really bad habit — LLMs start to describe the whole game in
reactive terms and hooks, and smear behaviour logic between visuals. So while the results are better
than one `.js` file from a vanilla Three.js run, they are still unacceptable, and no good rule can
break the model's favors, so I just dropped my attempts to make R3F good for games. It's still an
open discussion, though, so feel free to share your way.
