# Project

A game on SceNoCo: three.js scenes written in TSX — there is no React — and Unity's model of
behaviours, named `Behaviour`. Everything not described here is plain three.js, TypeScript, DOM and
CSS: write what you know. Every SceNoCo signature is in `node_modules/@scenoco-three/core/API.md` —
read it instead of the package's source.

- `src/scenes/` holds scenes and prefabs (`.tsx`), `src/` everything else; `src/main.ts` starts it.
- `npm run check` typechecks, and checks that every `.tsx` file only declares.
- `npm run dev` serves it. In development the page drives the running game from `window.__scenoco`
  (`__scenoco.help()` lists it): hold and step its clock, press keys, click, swipe, read behaviours by
  class. Evaluate in the page with any browser tool —
  `async () => { await __scenoco.press('Space'); return __scenoco.until("GameState.phase === 'over'") }`
  — then take its screenshot; in a Playwright test, `observe(page)` from `@scenoco-three/observer`.

# How SceNoCo works

**Scenes.** A `.tsx` file is a scene or a prefab, and it only declares — no hooks, loops, branches
or handlers; `npm run check` points at them. An object made from data with `new` — a font, a curve — is
a constant above the scene function: `const font = new Font(json)`. A tag is a three.js class you import:
`<BoxGeometry args={[1, 2, 3]} />` is `new BoxGeometry(1, 2, 3)`, and attributes are its
properties, R3F-style — `position={[0, 1, 0]}`, `color="#ff8800"`, `scale={2}`,
`shadow-mapSize={[1024, 1024]}`. A child node is added to its parent; a geometry or material fills
`geometry` / `material`; anything else names the property it fills:
`<Fog attach="fog" args={['#000000', 5, 30]} />`, `<Color attach="background" args={['#000000']} />`.
A node with `attach` is both added and assigned: `<Object3D attach="target" position={[0, -1, 0]} />`
inside a `DirectionalLight` is where it shines, and moves with it.

**Behaviours.** What lives in the scene and changes over time — moves, reacts, animates — is
Unity's MonoBehaviour: `class X extends Behaviour<Mesh>` in a `.ts` file, with the same hooks in
camelCase (awake, onEnable, start, fixedUpdate, update(dt), lateUpdate, onDisable, onDestroy;
onValidate after the editor changed a field or moved a node it holds, to redo what start built).
`this.node` is the three.js object it is on. Public fields are its settings, set as attributes when
it is attached as a TSX child of its node: `<Mesh><Spinner speed={2} /></Mesh>`.

**Links.** A typed ref made in the scene function links two objects: `const paddle = ref<Group>()`,
`<Group ref={paddle}>`, `<Follow target={paddle} />` — the field holds the object itself,
`target: Group | null = null`. A behaviour's tag takes `ref` too, linking that component:
`<Rigidbody2D ref={wheel} />`, `<WheelJoint2D connectedBody={wheel} />`. In code, behaviours find each other as in Unity — `getComponent(T)`,
`getComponentInChildren(T)`, `findObjectOfType(T)`, `findObjectsOfType(T)` — and can talk through
`Event<T>` fields and `this.listen(event, fn)`. Unity's tags are empty behaviours —
`class Enemy extends Behaviour {}`, `<Enemy />` on the node: `other.getComponent(Enemy)` is
`CompareTag`, `findObjectsOfType(Enemy)` is `FindGameObjectsWithTag`.

**Prefabs.** A prefab is made with `prefab()` around a function returning TSX with one root:
`export const Coin = prefab(() => <Mesh>…</Mesh>)`. Its tag places and names that root as a Unity
instance's Transform does — `<Coin position={[2, 0, 0]} name="bonus" />` — so a prefab never declares
`position`, `rotation`, `scale` or `name` itself. Only a prefab is instantiated —
`instantiate(Coin, { position })` builds a fresh one each call — or taken by a field, as Unity's
inspector does: `shot: Prefab | null = null`, `<Gun shot={Bullet} />`. A function not wrapped is a
plain TSX component, reused markup whose tag is its props: `<Arena ballSpeed={16} />`. A scene is a
plain function returning `<Scene>`: `SceneManager.load(Level2)`; `dontDestroyOnLoad(this)` keeps a node across loads. A glTF model is
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
Bodies and colliders are Unity's components — `<Rigidbody />` plus a collider on the same element, and
colliders on elements under it too, one compound body; a
collider alone is static and still follows its node — and contacts arrive as
`onCollisionEnter(collision)` / `onTriggerEnter(other)`. Unity's `Physics.raycast`, `CharacterController`
and joints are there as Unity has them; everything else is Rapier's own API, used directly:
`Physics.world`, `rb.rapierBody`, `collider.rapierCollider`. box2d's are the same in 2D:
`Physics2D.raycast`, the nine 2D joints, `Physics2D.world` and `rb.planckBody` for planck's own. With rapier, `main.ts` starts with
`await initRapier();`.

**Starting.** `main.ts` runs `const game = play(Main);`. The scene's first visible camera draws it, so a
scene puts its camera in, as in Unity — one without draws nothing; `visible = false` on it hands over to
the next, as Unity's `camera.enabled` does. An `OrthographicCamera` keeps its height and widens with the screen. `play(Main, { autoCamera: false })`
leaves cameras to you: set `game.camera` and size it. `game.renderer` is three's WebGLRenderer,
configured as three.js documents it — `game.renderer.shadowMap.enabled = true`.

From Unity: gameObject/transform → `this.node` · transform.localPosition → `this.node.position`
(three's position is in the parent's space) · transform.position → `this.node.getWorldPosition(v)` ·
Time.deltaTime → `update(dt)` or `Time.deltaTime` ·
GetComponent<T>() → `getComponent(T)` · FindObjectOfType<T>() → `findObjectOfType(T)` ·
Instantiate → `instantiate` · Destroy → `destroy` · Camera.main → `this.camera` ·
StartCoroutine → `this.startCoroutine` · `yield return new WaitForSeconds(1)` → `yield new WaitForSeconds(1)`
