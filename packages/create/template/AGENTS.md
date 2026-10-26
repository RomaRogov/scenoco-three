# Project

A game on SceNoCo: three.js scenes written in TSX — there is no React — and Unity's model of
behaviours, named `Behaviour`. Everything not described here is plain three.js, TypeScript, DOM and
CSS: write what you know. Every SceNoCo signature is in `node_modules/@scenoco-three/core/API.md` —
read it instead of the package's source.

- `src/scenes/` holds scenes and prefabs (`.tsx`), `src/` everything else; `src/main.ts` starts it.
- `npm run check` typechecks, and checks that every `.tsx` file only declares.
- `npm run dev` serves it. The `scenoco` MCP server (`.mcp.json`) runs the game in a headless Chrome:
  `screenshot` shows it; `simulate` drives it — keys, clicks, swipes — holds and steps its clock
  (`until: "GameState.phase === 'over'"`, `watch: ["Player.lane"]`) and reads behaviours by class.

# How SceNoCo works

**Scenes.** A `.tsx` file is a scene or a prefab, and it only declares — no hooks, loops, branches
or handlers; `npm run check` points at them. A tag is a three.js class you import:
`<BoxGeometry args={[1, 2, 3]} />` is `new BoxGeometry(1, 2, 3)`, and attributes are its
properties, R3F-style — `position={[0, 1, 0]}`, `color="#ff8800"`, `scale={2}`,
`shadow-mapSize={[1024, 1024]}`. A child node is added to its parent; a geometry or material fills
`geometry` / `material`; anything else names the property it fills:
`<Fog attach="fog" args={['#000000', 5, 30]} />`, `<Color attach="background" args={['#000000']} />`.

**Behaviours.** What lives in the scene and changes over time — moves, reacts, animates — is
Unity's MonoBehaviour: `class X extends Behaviour<Mesh>` in a `.ts` file, with the same hooks in
camelCase (awake, onEnable, start, fixedUpdate, update(dt), lateUpdate, onDisable, onDestroy).
`this.node` is the three.js object it is on. Public fields are its settings, set as attributes when
it is attached as a TSX child of its node: `<Mesh><Spinner speed={2} /></Mesh>`.

**Links.** A typed ref made in the scene function links two objects: `const paddle = ref<Group>()`,
`<Group ref={paddle}>`, `<Follow target={paddle} />` — the field holds the object itself,
`target: Group | null = null`. In code, behaviours find each other as in Unity — `getComponent(T)`,
`getComponentInChildren(T)`, `findObjectOfType(T)`, `findObjectsOfType(T)` — and can talk through
`Event<T>` fields and `this.listen(event, fn)`.

**Prefabs.** A prefab is a function returning TSX: `export const Coin = () => <Mesh>…</Mesh>`.
`instantiate(Coin, { position })` builds a fresh one each call, and a prefab can be used as a tag
inside another. A behaviour can take one as a field, as Unity's inspector does —
`shot: Prefab | null = null`, `<Gun shot={Bullet} />`. A scene is a prefab too:
`SceneManager.load(Level2)`; `dontDestroyOnLoad(this)` keeps a node across loads. A glTF model is
loaded with `const hero = sharedModel('/hero.glb')` and `await loadAssets(hero)` in `main.ts`, then
`instantiate(hero, { parent: this.node })`; its clips play through an `Animator`
(`addComponent(Animator)`, `animator.crossFade('Run', 0.1)`).

**Time.** `destroy(node)` is deferred to the end of the frame, as in Unity. Coroutines are Unity's:
`this.startCoroutine(this.spawnWaves())` runs a generator method that yields
`new WaitForSeconds(2)`, `new WaitUntil(() => …)` or `null` (a frame). `Time.timeScale = 0` pauses:
`update` keeps running with `dt` 0, while fixedUpdate, physics and `WaitForSeconds` stop — timing
done with setTimeout or Date.now does not pause with it.

**Input and UI.** UI is HTML and CSS in `index.html`, read and written with DOM APIs. A
`<button data-button="Pause">` reads like a key: `Input.getButtonDown('Pause')`. Keys, axes and the
pointer are Unity's: `Input.getKeyDown(KeyCode.Space)`, `Input.getAxis('Horizontal')`,
`Input.getMouseButtonDown(MouseButton.Left)`, `Input.pointer`.

**Physics** is a package: `npm install @scenoco-three/rapier` (3D) or `@scenoco-three/box2d` (2D).
Bodies and colliders are Unity's components — `<Rigidbody />` plus a collider on the same element; a
collider alone is static and still follows its node — and contacts arrive as
`onCollisionEnter(collision)` / `onTriggerEnter(other)`. Everything else is Rapier's own API:
`Physics.world`, `rb.rapierBody`, `collider.rapierCollider`. With rapier, `main.ts` starts with
`await initRapier();`.

**Starting.** `main.ts` runs `const game = play(Main);`. `game.renderer` is three's WebGLRenderer,
configured as three.js documents it — `game.renderer.shadowMap.enabled = true`.

From Unity: gameObject/transform → `this.node` · transform.localPosition → `this.node.position`
(three's position is in the parent's space) · transform.position → `this.node.getWorldPosition(v)` ·
Time.deltaTime → `update(dt)` or `Time.deltaTime` ·
GetComponent<T>() → `getComponent(T)` · FindObjectOfType<T>() → `findObjectOfType(T)` ·
Instantiate → `instantiate` · Destroy → `destroy` · Camera.main → `this.camera` ·
StartCoroutine → `this.startCoroutine` · `yield return new WaitForSeconds(1)` → `yield new WaitForSeconds(1)`
