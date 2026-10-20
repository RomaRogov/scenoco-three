# Project

A game on SceNoCo: three.js scenes written in TSX — there is no React — and Unity's model of
behaviours, named `Behaviour`. Everything not listed here is plain three.js, DOM and CSS: write what
you know. Every SceNoCo signature is in `node_modules/@scenoco-three/core/API.md` — read it instead of
the package's source.

- `src/scenes/` holds scenes and prefabs (`.tsx`), `src/` the behaviours (`.ts`), `src/main.ts` starts it.
- `npm run check` typechecks, and checks that every `.tsx` file only declares.
- `npm run dev` serves it. The `scenoco` MCP server (`.mcp.json`) runs the game in a headless Chrome:
  `screenshot` shows it; `simulate` drives it — keys, clicks, swipes — holds and steps its clock
  (`until: "GameState.phase === 'over'"`, `watch: ["Player.lane"]`) and reads behaviours by class.
  Check every change with it.

# Rules

1. A `.tsx` file is a scene, and a scene only declares. A tag is a three.js class you import:
   `<BoxGeometry args={[1, 2, 3]} />` is `new BoxGeometry(1, 2, 3)`, and attributes are its
   properties, R3F-style — `position={[0, 1, 0]}`, `color="#ff8800"`, `scale={2}`,
   `shadow-mapSize={[1024, 1024]}`. A child node is added to its parent; a geometry or material
   fills `geometry` / `material`; anything else names the property it fills:
   `<Fog attach="fog" args={['#000000', 5, 30]} />`, `<Color attach="background" args={['#000000']} />`.
   No hooks, loops, branches or handlers in a `.tsx` file — `npm run check` points at them.
2. A behaviour is a class in a `.ts` file: `class X extends Behaviour<Mesh>` — Unity's MonoBehaviour,
   same hooks in camelCase (awake, onEnable, start, fixedUpdate, update(dt), lateUpdate, onDisable,
   onDestroy). `this.node` is the three.js object it is on.
3. Public fields are its settings. Attach it as a TSX child of the element it drives:
   `<Mesh><Spinner speed={2} /></Mesh>`. Props set starting values only.
4. To link two objects, make a typed ref inside the scene function: `const paddle = ref<Group>()`,
   `<Group ref={paddle}>`, `<Follow target={paddle} />` — the field holds the object itself,
   `target: Group | null = null`. Behaviours find each other in code —
   `getComponent(T)`, `getComponentInChildren(T)`, `findObjectOfType(T)` — and talk through
   `Event<T>` fields and `this.listen(event, fn)`. `findObjectsOfType(T)` is cheap and skips what is
   being destroyed — keep no static lists.
5. A prefab is a function returning TSX: `export const Coin = () => <Mesh>…</Mesh>`.
   `instantiate(Coin, { position })` builds a fresh one each call; set fields on it afterwards.
   A behaviour that makes a prefab takes it as a field, as Unity's inspector does —
   `shot: Prefab | null = null`, `<Gun shot={Bullet} />` — and does not import the prefab file.
   A scene is one too: `SceneManager.load(Level2)`; `dontDestroyOnLoad(this)` keeps a node across loads.
   A glTF model is a prefab as well: `const hero = sharedModel('/hero.glb')` in a `.ts` module,
   `await loadAssets(hero)` in `main.ts`, then `instantiate(hero, { parent: this.node })`. Its clips
   play through an `Animator` on it: `addComponent(Animator)`, then `animator.crossFade('Run', 0.1)`.
6. Remove with `destroy(node)` — deferred to the end of the frame, as in Unity.
   Anything that waits is a coroutine, as in Unity: `this.startCoroutine(this.spawnWaves())` runs a
   generator method that yields `new WaitForSeconds(2)`, `new WaitUntil(() => …)` or `null` (a frame).
   `Time.timeScale = 0` pauses the game: update keeps running with `dt` 0, so a pause menu works,
   while fixedUpdate, physics and `WaitForSeconds` stop. No setTimeout, setInterval or Date.now.
7. UI is HTML and CSS in `index.html`; behaviours read and write it with DOM APIs. A button is
   `<button data-button="Pause">` and reads like a key: `Input.getButtonDown('Pause')`. Keys and
   axes are Unity's: `Input.getKeyDown(KeyCode.Space)`, `Input.getAxis('Horizontal')`.
8. Physics is a package: `npm install @scenoco-three/rapier` (3D) or `@scenoco-three/box2d` (2D).
   Bodies and colliders are Unity's components — `<Rigidbody />` plus a collider on the same element;
   a collider alone is static, and still follows its node — and contacts arrive as
   `onCollisionEnter(collision)` / `onTriggerEnter(other)`; a trigger is how to detect a pickup or a
   hit. Everything else is Rapier's own API: `Physics.world`, `rb.rapierBody`, `collider.rapierCollider`.
   With rapier, `main.ts` starts with `await initRapier();`.
9. `main.ts` starts it: `const game = play(Main);`. `game.renderer` is three's WebGLRenderer,
   configured as three.js documents it — `game.renderer.shadowMap.enabled = true`.
10. Where things go — a behaviour never builds what TSX can describe:
   - Whatever can be written as elements — meshes, groups, lights, geometries, materials — is TSX:
     a scene element or a prefab. A behaviour instantiates prefabs and changes their properties
     (`visible`, `position`, `material`'s colour). Code builds only what TSX cannot describe, such
     as geometry computed at runtime (a trail, a generated terrain).
   - Each kind is its own prefab — `FastEnemy`, `ArmoredEnemy`, `ArrowTower1`, `ArrowTower2` — and a
     behaviour picks which one to instantiate. Effects (bursts, rings, health bars) are prefabs too.
   - Variants nest, as Unity's nested prefabs do: a part shared by several prefabs is its own prefab,
     used as a tag — `<ArrowBase />` — and `ArrowTower2` is `<ArrowBase />` plus what level 2 adds.
   - The fixed level is written in the scene: ground, paths, bases, scenery, each an element with
     its position. A layout too big to write out (a 12×12 grid) is data in a `.ts` module, and a
     behaviour instantiates one tile prefab per cell.
   - Geometries and materials used in many places are made once in `src/assets.ts` and named from
     TSX: `<Mesh geometry={shapes.tile} material={paint.grass} />`.
   - State the game shares — gold, lives, the wave — is fields on one behaviour in the scene,
     `<Game />`, reached with `findObjectOfType(Game)`. Not a plain module object: that is not reset
     when the scene loads again, and the observer cannot read it.

From Unity: gameObject/transform → `this.node` · Time.deltaTime → `update(dt)` or `Time.deltaTime` ·
GetComponent<T>() → `getComponent(T)` · FindObjectOfType<T>() → `findObjectOfType(T)` ·
Instantiate → `instantiate` · Destroy → `destroy` · Camera.main → `this.camera` ·
StartCoroutine → `this.startCoroutine` · `yield return new WaitForSeconds(1)` → `yield new WaitForSeconds(1)`
