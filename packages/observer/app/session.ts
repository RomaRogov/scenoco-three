import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Object3D,
  PerspectiveCamera,
  Scene,
  Quaternion,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  type Camera,
} from 'three';
import * as THREE from 'three';
import {
  AXIS_NAMES,
  BUTTON_NAMES,
  Component,
  Engine,
  Input,
  SceneManager,
  System,
  Time,
  type AxisName,
  type ButtonName,
  type PrefabType,
  type SceneType,
} from '@scenoco-three/core';
import type { PreviewFrame, SimStep } from '../src/protocol.js';

export type ViewMode = 'stopped' | 'play';

/** Where to point the observer's camera and how far back to sit — what framing works out. */
export interface FocusTarget {
  center: Vector3;
  distance: number;
}

/**
 * The live scene, and everything that can be done to it.
 *
 * Two modes, and the difference is only who drives. In **edit** the scene is loaded but not
 * ticked, and the observer's own camera looks at it; in **play** the scene's own `mainCamera`
 * renders and `SceneManager` ticks. Both look at the same objects — there is no separate preview
 * build, which is what makes a capture evidence about the game rather than about a rendering of
 * a description of it.
 */
export class ObserverSession {
  readonly canvas: HTMLCanvasElement;
  /**
   * A real core `Engine`, with its frame loop left stopped.
   *
   * The observer drives `SceneManager` itself, so it needs none of the loop — but it does need to
   * *be* the host, because a system reaches the renderer through `Engine.current`. Building a
   * bare `WebGLRenderer` instead left that null, and the symptom was a scene whose `<Canvas>` HUD
   * simply never appeared: `UIRenderer` had nothing to size the screen with and skipped it, with
   * nothing anywhere saying why.
   */
  readonly engine: Engine;
  readonly renderer: WebGLRenderer;
  /** The observer's own camera. Renders through it while stopped. */
  readonly observerCamera: PerspectiveCamera;

  /**
   * The scene being observed: whatever the engine holds active *now*.
   *
   * Not a field set at `open`, because a game replaces its own scene — a restart that loads the
   * level again, a level that loads the next — and an observer holding the instance it opened
   * kept reporting the old, unloaded one: "MainScene: 1 node" after a restart, which reads as the
   * game having broken rather than the observer having looked away.
   */
  get scene(): Scene | null {
    return SceneManager.activeScene;
  }

  mode: ViewMode = 'stopped';
  playing = false;
  /** The class the open module exports, so the scene can be rebuilt from scratch. */
  private sceneClass: SceneType | null = null;
  /** Raised whenever the loaded scene is replaced, so the host can rebind to it. */
  onChange: (() => void) | null = null;

  /** One observer-owned stand-in per scene camera, for the UI overlay pass. */
  private readonly overlays = new WeakMap<Camera, Camera>();
  /**
   * Whether a capture draws the scene's screen-space UI over the frame while stopped.
   *
   * A `<Canvas>` is a child of the *scene's* camera and sizes itself to it, so from the
   * observer's own camera a HUD is a small rectangle floating in world space near a camera you
   * are usually looking away from. Play is the only place it is legible on its own.
   *
   * Switching this on draws it in a second pass instead: a camera matching the one the UI was
   * built for, over the top of the finished frame, clearing nothing. Nothing about the scene
   * graph changes — the Canvas stays the child of its camera, where the document put it and
   * where `outline` shows it.
   */
  private showUi = false;

  private clock = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // Constructed, never started: `Engine` owns the renderer, input and canvas sizing, and the
    // observer owns the frame loop.
    this.engine = new Engine({ canvas, container: canvas.parentElement ?? document.body });
    this.renderer = this.engine.renderer;
    this.observerCamera = new PerspectiveCamera(50, 1, 0.1, 2000);
    this.observerCamera.position.set(6, 5, 10);
    this.observerCamera.lookAt(0, 0, 0);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /**
   * Load a document from its generated module.
   *
   * The same module the game imports, served straight out of the project — so the observer is
   * looking at the real thing rather than at a rendering of a description of it.
   *
   * A scene loads as itself. A prefab is a node, not a scene, so it opens on a stage: an
   * otherwise empty scene holding one instance of it, lit well enough to see. That is Unity's
   * prefab mode, and it is the only way a document whose root is a `Mesh` can be looked at at
   * all — the alternative is finding a scene that happens to spawn one.
   */
  async open(url: string): Promise<void> {
    await SceneManager.unloadAll();
    // The compiler's generated module, served by the dev server — the same one the game imports.
    const module = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
    const exported = Object.values(module).filter((value): value is new () => object => typeof value === 'function');
    const SceneClass = exported.find((value): value is SceneType => Scene.prototype.isPrototypeOf(value.prototype));
    const PrefabClass = exported.find(
      (value): value is PrefabType<Object3D> => Object3D.prototype.isPrototypeOf(value.prototype),
    );
    if (!SceneClass && !PrefabClass) throw new Error(`${url} exports no scene or prefab class`);

    this.sceneClass = SceneClass ?? stageFor(PrefabClass!);
    try {
      await SceneManager.load(this.sceneClass);
    } catch (error) {
      // A load that threw left nothing behind, and a remembered class made every later call wait
      // five seconds and report the scene "still loading". Say it failed, and that nothing is open.
      this.sceneClass = null;
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`the scene failed to load: ${reason} — nothing is open; fix it and \`open\` again`);
    }
    this.resize(); // the scene's camera only exists now, and it is the one play mode renders through

    // One draw to make the scene's render settings current — which is what asks for the post
    // chain — then wait for it. Without this the first `screenshot` after opening shows no post
    // passes, because the composer is a dynamic import that has not landed yet, and "no bloom"
    // is indistinguishable from "the <Bloom> I just wrote does not work".
    this.render();
    await this.engine.effectsReady();

    this.onChange?.();
  }

  // --- the scene's UI, while stopped ----------------------------------------------------------

  /**
   * Draw the UI over the finished frame.
   *
   * `render` takes any `Object3D` as its root, so passing the UI root draws that subtree and
   * nothing else — no layer masks to keep in step as uikit builds and drops meshes during
   * layout, and no second copy of the scene.
   *
   * The camera is a copy rather than the scene's own. A render pass writes to the camera it is
   * given — `matrixWorldInverse`, the projection matrix — and a tool-drawn overlay has no
   * business leaving fingerprints on the camera the document declared. The copy takes its world
   * matrix and its projection, so the UI lands exactly where it was laid out to land.
   */
  private renderUiOverlay(): void {
    const autoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    for (const root of this.uiRoots()) {
      const owner = root.parent as Camera | null;
      if (!owner?.isCamera) continue;
      this.renderer.render(root, this.overlayFor(owner));
    }
    this.renderer.autoClear = autoClear;
  }

  /** A stand-in for one of the scene's cameras, kept in step with it and owned by the observer. */
  private overlayFor(owner: Camera): Camera {
    let copy = this.overlays.get(owner);
    if (!copy) {
      // Through `Object3D` on purpose: `clone(recursive)` is its signature, and `Camera` redeclares
      // it as `clone(): this`, which drops the parameter the runtime still honours. Cloning
      // recursively here would copy the UI subtree, which is rendered rather than copied.
      copy = (owner as Object3D).clone(false) as Camera;
      this.overlays.set(owner, copy);
    }
    copy.copy(owner, false); // projection parameters — fov, aspect, near, far
    // The owner's `matrix` is local to its parent; its `matrixWorld` is where it actually is,
    // and the overlay has no parent to inherit from.
    copy.matrixAutoUpdate = false;
    copy.matrixWorldAutoUpdate = false;
    copy.matrix.copy(owner.matrixWorld);
    copy.matrixWorld.copy(owner.matrixWorld);
    copy.matrixWorldNeedsUpdate = false;
    return copy;
  }

  /**
   * The screen-space UI roots in the scene.
   *
   * Identified by the fields a uikit `Fullscreen` alone carries, rather than by importing uikit:
   * a project that uses no UI must not drag the package in, and the observer has no business
   * depending on one tag package over another.
   */
  private uiRoots(): Object3D[] {
    const found: Object3D[] = [];
    for (const child of this.scene?.children ?? []) {
      if (!(child as Partial<Camera>).isCamera) continue;
      for (const grandchild of child.children) {
        if ('pixelSize' in grandchild && 'sizeX' in grandchild && 'sizeY' in grandchild) {
          found.push(grandchild);
        }
      }
    }
    return found;
  }

  // --- transport ---------------------------------------------------------------------------

  /**
   * Start the simulation on the scene as it is now — including everything moved since it loaded.
   *
   * The systems get told to re-read the scene graph first. Edit mode is a whole session of
   * writing transforms from outside the simulation, and a physics world does not watch for that:
   * without this, a crate dragged across the level plays with its collider still where the
   * document put it, and things bounce off empty space.
   */
  run(): void {
    for (const system of this.scene?.systems ?? []) system.syncTransforms?.();
    this.mode = 'play';
    this.playing = true;
    SceneManager.resetFrameClock();
    // The toolbar reads `mode` and `playing`, and the React chrome only re-reads on this call.
    // `stop` always raised it and these two never did, so a scene driven into play mode from the
    // MCP kept a toolbar insisting it was stopped: Play still offered, Pause and Step still
    // hidden, while the scene ran behind them. Whoever is watching has to be able to trust it.
    this.onChange?.();
  }

  pause(): void {
    this.playing = false;
    this.onChange?.();
  }

  /**
   * Stop, and put the scene back as the document describes it — Unity's Stop, which discards
   * everything play mode did.
   *
   * Rebuilt rather than merely halted, because a run has to start from the same place every
   * time. Without it a second `simulate` batch begins wherever the first one left off, and two
   * identical batches disagree — which is precisely the property an agent is relying on when it
   * drives a scene to a condition and looks at it.
   */
  async stop(): Promise<void> {
    this.playing = false;
    this.mode = 'stopped';
    if (!this.sceneClass) return;
    await SceneManager.unloadAll();
    // The engine's globals are part of "everything play mode did". `Time.timeScale` is the one
    // that bit: a game that freezes itself at game over with `timeScale = 0` left the *reloaded*
    // scene frozen too, so every batch after a game over read back a scene that never moved —
    // and a key held when a batch ended stayed held into the next one.
    Time.timeScale = 1;
    Time.reset();
    Input.clear();
    await SceneManager.load(this.sceneClass);
    this.resize(); // a rebuilt scene brings a fresh camera with a default aspect
    this.clock = 0;
    SceneManager.resetFrameClock();
    this.onChange?.();
  }

  /**
   * Wait out a scene load the *game* started.
   *
   * `SceneManager.load` is asynchronous, and a game restarts a round with it — "press R" is the
   * ordinary case. For as long as it runs there is no active scene, so every tool that reads one
   * answered "no scene is open", which reads as "your game is broken" rather than "ask again in a
   * moment". An agent that hit it went looking for a bug it did not have.
   *
   * Stepping is no escape: `step` advances a synthetic clock, so a load resolving on real timers
   * or a real network never completes however many frames are asked for. The wait has to be a
   * real one, and it belongs here rather than in every caller.
   *
   * Only ever a wait when something *was* opened. With no document open at all the answer is
   * immediate, and it says which of the two it is.
   */
  async settled(): Promise<void> {
    if (this.scene) return;
    if (!this.sceneClass) throw new Error('no scene is open — `open` a document first');
    for (let i = 0; i < 200 && !this.scene; i++) {
      await new Promise((done) => setTimeout(done, 25));
    }
    if (!this.scene) throw new Error('the scene has been loading for 5s — its onLoad may be stuck');
  }

  /** Advance by exactly one step — the frame-by-frame inspection a bug needs. */
  step(dt = 1 / 60): void {
    this.clock += dt * 1000;
    SceneManager.tick(this.clock);
    Input.endFrame();
  }

  /**
   * One frame of the observer's own loop.
   *
   * `Input.endFrame` runs whether or not the scene stepped, and that is the point: `Engine` calls
   * it from the loop the observer does not use, so nothing else would. Without it `getKeyDown` is
   * true for ever after one press and `mouseDelta` keeps its last value — a camera that never
   * stops turning once you have turned it, and a one-frame edge that fires on every frame.
   */
  tick(dt: number): void {
    if (this.playing) this.step(dt);
    else {
      // Edit mode ticks nothing, which leaves anything presentational stale — a UI layout most
      // visibly. Systems that can be brought up to date without simulating say so.
      for (const system of this.scene?.systems ?? []) system.layout?.(dt);
      Input.endFrame();
    }
    this.render();
  }

  render(camera: Camera = this.renderCamera()): void {
    if (!this.scene) return;
    // Through the engine, not `renderer.render`: the scene's render document — tone mapping,
    // bloom, vignette, fog — is applied there, and a viewport that skips it is not showing the
    // scene the game draws.
    this.engine.renderScene(this.scene, camera);
    // Only in edit mode: play renders through the scene's own camera, where the UI is already
    // in front of it, and a run has to show exactly what the game shows — once.
    if (this.showUi && this.mode === 'stopped') this.renderUiOverlay();
  }

  /** Play renders through the scene's camera; stopped through the observer's own. */
  renderCamera(): Camera {
    return this.mode === 'play' && this.scene?.mainCamera ? this.scene.mainCamera : this.observerCamera;
  }

  /**
   * Match the drawing buffer and **both** cameras to the canvas.
   *
   * `Engine.resize` sizes the buffer and the scene's camera, and it is the very code the game
   * runs — so it is called rather than reimplemented. But the observer never starts the engine's
   * loop, which is what would normally keep calling it: the constructor's one call happens before
   * any scene is loaded, so `mainCamera` does not exist yet and never gets an aspect. Play mode
   * then renders the game through a camera still at aspect 1 and every sphere is an ellipse.
   *
   * The observer's own camera is not the engine's business, so it is handled here.
   */
  /**
   * Run at the size of a call's frame. The observer sized the page to it before asking, so the
   * game itself is that size — its camera's aspect, its UI's layout, where a click lands — and a
   * shot is the canvas as it stands. A frame is a window size, not a picture size: a 390×844 call
   * is the game on a phone, not a phone-shaped crop of the desktop game.
   */
  fit(frame: PreviewFrame): void {
    if (innerWidth !== frame.width || innerHeight !== frame.height) {
      throw new Error(`internal: the page is ${innerWidth}×${innerHeight}, not the ${frame.width}×${frame.height} asked for`);
    }
    const buffer = this.renderer.domElement;
    if (buffer.width === frame.width && buffer.height === frame.height) return;
    this.resize();
    // A UI lays out against the size it last saw, so it catches up before anything is read or shot.
    for (const system of this.scene?.systems ?? []) system.layout?.(0);
  }

  resize(): void {
    this.engine.resize();
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.observerCamera.aspect = w / Math.max(h, 1);
    this.observerCamera.updateProjectionMatrix();
  }

  /**
   * Put the observer's camera where it can see everything, and say what to look at.
   *
   * The **point** comes back rather than the camera being aimed here, because the camera rig owns
   * orientation: it accumulates yaw and pitch and writes them every frame, so a `lookAt` from
   * outside is overwritten on the very next one. Framing that positioned the camera perfectly and
   * then pointed it somewhere else was exactly that bug.
   */
  frameAll(): FocusTarget | null {
    if (!this.scene) return null;
    // Only what the document authored. The gizmo's helper is a child of the scene too, and its
    // picker plane is 100000 units across: framing that put the camera millions of units out, and
    // since the handles scale with camera distance, each press of the key made the next one worse.
    const box = boxOfAuthored(this.scene);
    return box.isEmpty() ? null : this.focus(box);
  }

  /** What it takes to see one node: where it is, and from how far. */
  frameNode(node: Object3D): FocusTarget | null {
    const box = new Box3().setFromObject(node);
    return box.isEmpty() ? null : this.focus(box);
  }

  /**
   * Measure, rather than move.
   *
   * The camera's *angle* belongs to whoever is flying it, and framing must not take it — so this
   * answers only the half a bounding box can answer, and `CameraRig.frameOn` decides where that
   * puts the camera given where it currently looks.
   */
  private focus(box: Box3): FocusTarget {
    const center = box.getCenter(new Vector3());
    // A floor of half a unit, so framing a point light or an empty group doesn't put the camera
    // inside it.
    const radius = Math.max(box.getSize(new Vector3()).length() / 2, 0.5);
    const fit = radius / Math.sin((this.observerCamera.fov * Math.PI) / 360);
    return { center, distance: fit * 1.2 }; // a fifth of a radius of air around the subject
  }

  // --- what an agent asks for ---------------------------------------------------------------

  /**
   * Render one PNG from an arbitrary viewpoint.
   *
   * A capture camera rather than the observer's own: a shot must not move what anyone watching
   * keyboard is looking at, and two shots of the same run have to be comparable.
   */
  preview(frame: PreviewFrame, at: string | undefined, lookAt?: string, fov?: number): string {
    const scene = this.scene;
    if (!scene) throw new Error('no scene is open');
    if (!this.scene) throw new Error('no scene is open');

    // No viewpoint: exactly what the player sees — the game camera where the game left it, HUD
    // and all. Every other shot is aimed by the caller, so a game camera pointed at nothing went
    // unseen through three whole builds; this is the shot that shows it.
    if (at !== undefined && at.trim() === '') {
      throw new Error('cameraPos is empty — leave it out for exactly what the player sees, or give a point: "y: 6; z: 12"');
    }
    const asPlayer = at === undefined;
    if (asPlayer && !this.scene.mainCamera) {
      throw new Error('the scene has no camera to look through — give cameraPos to aim a shot');
    }
    const usingScene = (frame.ui || asPlayer) && this.scene.mainCamera;
    const { clientWidth: width, clientHeight: height } = this.canvas;
    const camera = usingScene
      ? (this.scene.mainCamera as PerspectiveCamera)
      : new PerspectiveCamera(50, width / Math.max(height, 1), 0.1, 2000);

    const previous = {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      fov: camera.fov,
    };
    if (!asPlayer) {
      const eye = anchoredPoint(scene, at!);
      if (!eye) throw new Error(`cameraPos="${at}" is not a point — write "y: 6; z: 12", or "#player y: 6; z: 8"`);
      const target = (lookAt ? anchoredPoint(scene, lookAt) : undefined) ?? new Vector3();
      camera.position.copy(eye);
      camera.lookAt(target);
    }
    // How wide the lens is, optionally — a vertical field of view in degrees, which is what a
    // perspective camera has always had. Nothing here derives it: every earlier attempt to work
    // a viewpoint or a lens out from the scene was a rule the caller had to hold in their head,
    // and one of them failed silently by framing a helper the tool had added rather than the game.
    if (fov !== undefined) camera.fov = fov;
    camera.updateProjectionMatrix();

    // Bring presentation up to the state as it is *now*. A UI lays out once per tick, so a step
    // that changed something since — an `eval` that showed the end panel — was captured as the
    // frame before it: the panel reported active and the picture showed nothing. Layout simulates
    // nothing, so it is safe at any moment.
    //
    // It is also what makes `ui` and `fov` go together. A `<Canvas>` is a plane on the game camera,
    // sized to fill that camera's frustum at its field of view, and it re-reads the fov when it
    // lays out: laid out after the relens, it fills the new frustum rather than the old one.
    for (const system of scene.systems) system.layout?.(0);
    // The canvas is the frame — see `fit` — so the shot is the canvas as it stands.
    this.engine.renderScene(this.scene, camera);
    const dataUrl = this.canvas.toDataURL('image/png');

    // Put the camera back: a capture is an observation, and an observation that moves the thing
    // it observed is not one.
    camera.position.copy(previous.position);
    camera.quaternion.copy(previous.quaternion);
    // `fov` too, now that a capture may set it: with `ui` on, this is the scene's own camera,
    // and a shot that quietly relensed it would be the observation changing the thing observed.
    camera.fov = previous.fov;
    camera.updateProjectionMatrix();
    // And the UI back onto the camera's own lens, so the game goes on with the HUD it had.
    if (usingScene && fov !== undefined) for (const system of scene.systems) system.layout?.(0);
    return dataUrl;
  }


  /**
   * Read the state at an `id` the document declared.
   *
   * The generated scene class carries a typed field per `id`, so this is a property lookup —
   * there is no registry to consult and no name index to keep.
   */
  telemetry(id: string): unknown {
    const thing = this.scene?.byId(id);
    if (!thing) {
      const known = this.knownIds();
      throw new Error(
        `no id "${id}" here.` +
          (known.length ? ` Ids: ${known.join(', ')}.` : '') +
          ' A spawned instance has an id only if instantiate() was given one: { id: "slime3" }.',
      );
    }
    if (thing instanceof Component) {
      return { id, type: thing.constructor.name, enabled: thing.enabled, ...readable(thing) };
    }
    const node = thing;
    return {
      id,
      type: node.type,
      name: node.name,
      position: node.position.toArray(),
      eulerAngles: node.eulerAngles.toArray(),
      scale: node.scale.toArray(),
      visible: node.visible,
      active: node.activeInHierarchy,
      components: node.components.map((component) => ({
        type: component.constructor.name,
        enabled: component.enabled,
        ...readable(component),
      })),
    };
  }

  /**
   * The scene as text: every node with its id, type, position and components, indented by
   * depth, then the systems with their values.
   *
   * The cheapest and most exact view an agent can take. A screenshot answers "does it look
   * right"; this answers "what is there, where, in what state" in a few hundred tokens, with
   * ids to reach every part of it. Tool-drawn helpers are left out; the world position is the
   * one that matters for "where".
   */
  outline(rootId?: string, depth = 4): string {
    const scene = this.scene;
    if (!scene) throw new Error('no scene is open');
    const ids = this.idsByThing();
    const round = (n: number): number => Math.round(n * 100) / 100;
    const lines: string[] = [];
    let shown = 0;
    let total = 0;
    const CAP = 200;

    const values = (thing: object, base: Function = Component): string => {
      const entries = Object.entries(readable(thing, base)).slice(0, 5);
      return entries.length ? `(${entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')})` : '';
    };
    /**
     * Whether a node is actually on screen.
     *
     * For anything ordinary that is `visible`. A UI element answers that honestly too, but its
     * own signals know more: `displayed` and `isVisible` also account for clipping, so an
     * element scrolled out of its container reads hidden rather than drawn.
     *
     * Duck-typed rather than imported: `@scenoco-three/ui` is optional, and the observer opens
     * projects that do not have it.
     */
    const drawn = (node: Object3D): boolean => {
      const uikit = node as unknown as {
        displayed?: { value?: boolean };
        isVisible?: { value?: boolean };
        size?: { value?: unknown };
      };
      if (uikit.displayed && uikit.isVisible) {
        // uikit computes these on its first layout pass and they all read false until then, with
        // `size` still null — which is exactly the state a document that has just been opened is
        // in. Reporting from them there marked every element of a HUD that was about to draw as
        // `hidden`, on the first `outline` an agent takes. Until it has a size, say what the
        // document says.
        if (uikit.size?.value == null) return node.activeInHierarchy;
        return uikit.displayed.value !== false && uikit.isVisible.value !== false;
      }
      return node.visible;
    };

    const describeNode = (node: Object3D): string => {
      const id = ids.get(node);
      const p = node.getWorldPosition(SCRATCH);
      const flags = `${drawn(node) ? '' : ' hidden'}${node.activeInHierarchy ? '' : ' inactive'}`;
      const components = node.components.map((c) => `${c.constructor.name}${ids.has(c) ? `#${ids.get(c)}` : ''}${values(c)}`);
      // The class when it says more than three's type string: a `Text` or a `SlimePrefab` is a
      // `Mesh` to three, and "Mesh" is not what a reader wants to know about it.
      const kind = node.constructor.name !== node.type && node.constructor.name ? `${node.constructor.name} (${node.type})` : node.type;
      return (
        `${kind}${id ? ` #${id}` : ''}${node.name ? ` "${node.name}"` : ''} @ (${round(p.x)}, ${round(p.y)}, ${round(p.z)})` +
        `${flags}${components.length ? `  [${components.join(', ')}]` : ''}`
      );
    };
    const walk = (node: Object3D, level: number): void => {
      if (node.userData.scenocoToolOnly) return;
      total++;
      if (shown >= CAP) return;
      shown++;
      if (node !== scene) lines.push(`${'  '.repeat(level)}${describeNode(node)}`);
      const children = node.children.filter((c) => !c.userData.scenocoToolOnly);
      if (level >= depth && children.length) {
        lines.push(`${'  '.repeat(level + 1)}… ${children.length} more below — outline with id= to see them`);
        for (const child of children) total++;
        return;
      }
      for (const child of children) walk(child, level + 1);
    };

    let root: Object3D = scene;
    if (rootId) {
      const thing = scene.byId(rootId);
      if (!thing) throw new Error(`no id "${rootId}" here. Ids: ${this.knownIds().join(', ')}`);
      if (thing instanceof Component) throw new Error(`"${rootId}" names a component; outline takes a node id`);
      root = thing;
    }
    walk(root, root === scene ? -1 : 0);

    const systems = scene.systems.map((s) => `${s.constructor.name}${values(s, System)}`);
    const head = root === scene
      ? `${scene.constructor.name}: ${total} node${total === 1 ? '' : 's'}${systems.length ? `; systems: ${systems.join(', ')}` : ''}`
      : `#${rootId}: ${total} node${total === 1 ? '' : 's'}`;
    if (total > shown) lines.push(`… ${total - shown} more nodes not shown — outline with id= for a subtree`);
    return [head, ...lines].join('\n');
  }

  /** Every node and component that has an id, keyed by the thing, for the outline. */
  private idsByThing(): Map<object, string> {
    const map = new Map<object, string>();
    const scene = this.scene;
    if (!scene) return map;
    for (const key of this.knownIds()) {
      const thing = scene.byId(key);
      if (thing) map.set(thing, key);
    }
    return map;
  }

  /** Every id `telemetry` would answer for right now: the document's, then the spawned. */
  private knownIds(): string[] {
    const scene = this.scene;
    if (!scene) return [];
    const authored = Object.keys(scene).filter((key) => {
      if (key === 'mainCamera') return false;
      const value = (scene as unknown as Record<string, unknown>)[key];
      return value instanceof Component || (value as Partial<Object3D>)?.isObject3D === true;
    });
    return [...authored, ...scene.runtime.ids.keys()];
  }

  /**
   * Run a snippet against the live scene.
   *
   * This is the one place the MCP has hands, and they reach only the running scene: nothing here
   * can touch a file, and `stop` throws the whole result away. It exists because proving one
   * specific interaction — a bullet meeting a slime — is otherwise a hunt through gameplay with
   * keys and screenshots, while "put a slime in front of the player and fire" is three lines.
   * The snippet is the body of an async function; whatever it returns is made plain for JSON.
   */
  async evaluate(code: string): Promise<unknown> {
    const scene = this.scene;
    if (!scene) throw new Error('no scene is open');
    // A component by its class or its class's name — the classes are in scope too, and
    // `system(Game)` once answered null for a class it would have found by "Game". `id` narrows the
    // search to one node and what is under it: `find(Button, "start")` is the Button on #start.
    const matches = (value: object, type: string | Function): boolean =>
      typeof type === 'function' ? value instanceof type : value.constructor.name === type;
    const findAll = (type: string | Function, id?: string): Component[] => {
      const found: Component[] = [];
      const root = id === undefined ? scene : scene.byId(id);
      if (!root) throw new Error(`no node has id "${id}"`);
      root.traverse((node) => {
        for (const component of node.components) {
          if (matches(component, type)) found.push(component);
        }
      });
      return found;
    };
    const find = (type: string | Function, id?: string): Component | null => findAll(type, id)[0] ?? null;
    const system = (type: string | Function): System | null =>
      scene.systems.find((candidate) => matches(candidate, type)) ?? null;
    const byId = (path: string): Object3D | Component | null => scene.byId(path);
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
      ...args: string[]
    ) => (...args: unknown[]) => Promise<unknown>;
    const given: Record<string, unknown> = { scene, byId, find, findAll, system, Time, Input, SceneManager, THREE };
    // And every component and system class the scene is running, by its own name, so a snippet
    // is written as game code is — `byId('start', Button)`, `getComponent(Core)` — rather than in
    // a dialect of its own.
    const classes = { ...classesIn(scene) };
    for (const name of Object.keys(given)) delete classes[name];
    const scope = { ...classes, ...given };
    // The snippet runs one function in, so its own `const Core = …` shadows a class given here
    // rather than failing as "Identifier 'Core' has already been declared".
    const body = new AsyncFunction(...Object.keys(scope), `return (async () => {\n${code}\n})();`);
    try {
      return plain(await body(...Object.values(scope)));
    } catch (error) {
      // A class only inside a prefab is not here until one is spawned, and "Core is not defined"
      // says nothing about where classes come from — or that its name always works.
      const missing = error instanceof ReferenceError ? /^(\w+) is not defined/.exec(error.message)?.[1] : undefined;
      if (missing && error instanceof Error) {
        error.message +=
          ` — eval has the classes the scene is running: ${Object.keys(classes).join(', ') || 'none yet'}.` +
          ` One that lives only inside a prefab arrives with the first spawn; by name it always works:` +
          ` find("${missing}"), findAll("${missing}").`;
      }
      throw error;
    }
  }

  /** Run a batch of steps in order, collecting whatever each one produced. */
  async simulate(
    steps: readonly SimStep[],
    frame: PreviewFrame,
  ): Promise<Array<{ kind: 'image' | 'json' | 'text'; value: unknown }>> {
    const out: Array<{ kind: 'image' | 'json' | 'text'; value: unknown }> = [];
    for (const step of steps) {
      // A step that reads the scene waits for one that is mid-load. `stop` does not: it is the
      // way *out* of a bad state, so it must never be gated on the state being good.
      if (step.do !== 'stop') await this.settled();
      switch (step.do) {
        case 'play':
          this.run();
          break;
        case 'pause':
          this.pause();
          break;
        case 'stop':
          await this.stop();
          break;
        case 'step':
          await this.stepVisibly(step.frames ?? 1, step.dt ?? 1 / 60);
          break;
        case 'press':
          this.key('keydown', step.key);
          await this.stepVisibly(1);
          this.key('keyup', step.key);
          break;
        case 'keyDown':
          this.key('keydown', step.key);
          break;
        case 'keyUp':
          this.key('keyup', step.key);
          break;
        case 'axis':
          Input.setAxis(axisNamed(step.axis), step.value);
          break;
        case 'button':
          Input.setButton(buttonNamed(step.button), true);
          await this.stepVisibly(1);
          Input.setButton(buttonNamed(step.button), null);
          break;
        case 'buttonDown':
          Input.setButton(buttonNamed(step.button), true);
          break;
        case 'buttonUp':
          Input.setButton(buttonNamed(step.button), null);
          break;
        case 'click':
          // A mouse arrives before it presses. What was under the pointer is decided on a move,
          // so a click at a new point with no move before it pressed whatever the pointer last
          // hovered — a button clicked from across the screen never heard it.
          this.pointer('pointermove', step.x, step.y);
          this.pointer('pointerdown', step.x, step.y, step.button);
          this.pointer('pointerup', step.x, step.y, step.button);
          break;
        case 'move':
          this.pointer('pointermove', step.x, step.y);
          break;
        case 'preview':
          out.push({
            kind: 'image',
            // `ui` on the step answers for that shot; the batch's is the default.
            value: this.preview(step.ui === undefined ? frame : { ...frame, ui: step.ui }, step.cameraPos, step.lookAt, step.fov),
          });
          break;
        case 'telemetry':
          out.push({ kind: 'json', value: this.telemetry(step.id) });
          break;
        case 'eval':
          out.push({ kind: 'json', value: await this.evaluate(step.code) });
          break;
        case 'outline':
          out.push({ kind: 'text', value: this.outline(step.id, step.depth) });
          break;
      }
    }
    return out;
  }

  /**
   * Advance the scene where someone can watch it happen.
   *
   * `step` only ticks; the observer's own loop is what draws, and it does not get a turn while a
   * batch is running — the whole batch is one synchronous task. Left that way, a person watching
   * the page sees a frozen canvas and then a jump to the final state, which is indistinguishable
   * from the observer having hung. So this draws each frame and hands the browser a chance to paint.
   *
   * Yielding every fourth frame rather than every frame: painting more often than that buys no
   * legibility and a long batch would otherwise run at wall-clock speed. Determinism is untouched
   * either way — the step is a fixed `dt`, so when the frames are drawn changes nothing about what
   * they contain.
   */
  private async stepVisibly(frames: number, dt = 1 / 60): Promise<void> {
    for (let i = 0; i < frames; i++) {
      this.step(dt);
      // Nobody is watching a hidden tab, and the observer's page is normally hidden — it runs in a
      // the agent is working in — so a hidden batch neither paints nor yields. It has to be this
      // way round: a browser delivers no animation frames to a hidden tab at all, and throttles
      // its timers to one a second, so a batch that yielded through either sat there until someone
      // clicked the tab, and every long `step` "timed out" while actually being applied.
      if (document.hidden) continue;
      this.render();
      if (i % 4 === 3) await yieldToPage();
    }
    // The final frame is drawn either way, so the tab is right whenever it is next looked at.
    this.render();
  }

  /**
   * Synthetic input is a real DOM event.
   *
   * `Input` listens to the page, so there is nothing to fake and no test-only path through it —
   * an agent's key press travels the same route a person's does, which is the only way a
   * simulated run tells you anything about the real one.
   */
  private key(type: 'keydown' | 'keyup', name: string): void {
    const code = keyCodeFor(name);
    window.dispatchEvent(new KeyboardEvent(type, { code, key: name, bubbles: true }));
  }

  /**
   * A pointer event at `x, y` in canvas pixels — which are the pixels of every shot, since the
   * canvas is the frame (see `fit`).
   */
  private pointer(type: string, x?: number, y?: number, button?: 'left' | 'right' | 'middle'): void {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        clientX: rect.left + (x ?? rect.width / 2),
        clientY: rect.top + (y ?? rect.height / 2),
        button: button === 'right' ? 2 : button === 'middle' ? 1 : 0,
        pointerId: 1,
      }),
    );
  }
}

/**
 * Hand the page one turn of the event loop, unthrottled.
 *
 * A message on a `MessageChannel` is the one macrotask a background tab still runs promptly:
 * `setTimeout` is clamped to a second there, and `requestAnimationFrame` never fires at all.
 */
function yieldToPage(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}

/** `"y: 6; z: 12"` — the document's own vector grammar, so an agent learns one. */
/**
 * The bounds of what the *document* authored.
 *
 * A tool draws into the same scene the game does — the observer's own lights on a prefab stage,
 * and in the editor a gizmo helper carrying a 100000-unit picker plane. Every question of the
 * form "where should the camera go to see this?" has to ask about the authored children alone,
 * or it answers about the helper. There is one of these because there were two, and only one of
 * them had the filter.
 */
export function boxOfAuthored(scene: Scene): Box3 {
  const box = new Box3();
  for (const child of scene.children) {
    if (child.userData.scenocoToolOnly) continue;
    box.union(new Box3().setFromObject(child));
  }
  return box;
}

export function pointOf(text?: string): Vector3 | undefined {
  if (!text) return undefined;
  const point = new Vector3();
  let wrote = false;
  for (const part of text.split(';')) {
    const [axis, value] = part.split(':');
    const n = Number(value?.trim());
    if (!axis || !Number.isFinite(n)) continue;
    const key = axis.trim() as 'x' | 'y' | 'z';
    if (key === 'x' || key === 'y' || key === 'z') {
      point[key] = n;
      wrote = true;
    }
  }
  return wrote ? point : undefined;
}

const SCRATCH = new Vector3();

/**
 * A stated point, or an anchor: `"#player"` is that node's world position, and
 * `"#player y: 6; z: 8"` is it plus an offset. The one derivation a capture allows, because it is
 * still a statement about a named thing rather than a computation over the scene.
 */
export function anchoredPoint(scene: Scene, text: string): Vector3 | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('#')) return pointOf(trimmed);
  const match = /^#(\S+)\s*(.*)$/.exec(trimmed);
  if (!match) return undefined;
  const thing = scene.byId(match[1]!);
  if (!thing) throw new Error(`"#${match[1]}" is not an id here`);
  const node = thing instanceof Component ? thing.object3D : thing;
  const base = node.getWorldPosition(new Vector3());
  if (!match[2]) return base;
  const offset = pointOf(match[2]);
  if (!offset) throw new Error(`"${match[2]}" after #${match[1]} is not an offset — write "y: 6; z: 8"`);
  return base.add(offset);
}

/**
 * A `KeyCode` member name as the DOM spells it.
 *
 * `Space` is `Space`, `W` is `KeyW`, `LeftArrow` is `ArrowLeft` — one small table, because the
 * two vocabularies genuinely differ and an agent should write the one the engine documents.
 */
/**
 * A named axis or button, checked against the table rather than passed through.
 *
 * The same rule `keyCodeFor` follows: a name nothing recognises fails the batch and says what
 * exists, because a step that silently drives nothing is a batch that reads as "the game ignores
 * input" when the truth is a typo.
 */
function axisNamed(name: string): AxisName {
  if ((AXIS_NAMES as readonly string[]).includes(name)) return name as AxisName;
  throw new Error(`axis="${name}" is not an input axis. There is: ${AXIS_NAMES.join(', ')}`);
}

function buttonNamed(name: string): ButtonName {
  if ((BUTTON_NAMES as readonly string[]).includes(name)) return name as ButtonName;
  throw new Error(`button="${name}" is not an input button. There is: ${BUTTON_NAMES.join(', ')}`);
}

function keyCodeFor(name: string): string {
  const special: Record<string, string> = {
    Space: 'Space',
    LeftArrow: 'ArrowLeft',
    RightArrow: 'ArrowRight',
    UpArrow: 'ArrowUp',
    DownArrow: 'ArrowDown',
    Return: 'Enter',
    Escape: 'Escape',
    Tab: 'Tab',
    LeftShift: 'ShiftLeft',
    LeftControl: 'ControlLeft',
  };
  if (special[name]) return special[name]!;
  if (/^[A-Z]$/.test(name)) return `Key${name}`;
  if (/^Alpha[0-9]$/.test(name)) return `Digit${name.slice(5)}`;
  return name;
}

/**
 * A component's values, read back: its own fields, and every getter its class declares.
 *
 * Getters matter more than fields here. The rule the framework teaches is that runtime state —
 * a score, a count, a cooldown — is a getter, not a public field; a telemetry that read fields
 * alone showed the *settings* and hid the *state*, and an agent worked around it by mirroring
 * every getter into a private field just to be able to read it. The walk stops at `Component`
 * itself, so `object3D`, `scene` and the base's own accessors are not repeated on every entry.
 */
function readable(component: object, base: Function = Component): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const put = (key: string, value: unknown): void => {
    if (value === null || ['number', 'string', 'boolean'].includes(typeof value)) out[key] = value;
    else if (value instanceof Vector3 || value instanceof Vector2) out[key] = value.toArray();
    else if (value instanceof Color) out[key] = `#${value.getHexString()}`;
  };
  for (const [key, value] of Object.entries(component)) {
    if (!key.startsWith('_')) put(key, value);
  }
  for (
    let proto = Object.getPrototypeOf(component);
    proto && proto !== Object.prototype && proto.constructor !== base;
    proto = Object.getPrototypeOf(proto)
  ) {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(proto))) {
      if (!descriptor.get || key.startsWith('_') || key in out) continue;
      try {
        put(key, descriptor.get.call(component));
      } catch {
        // A getter that throws before the scene is ready is not telemetry.
      }
    }
  }
  return out;
}

/**
 * What an `eval` snippet returned, made safe for JSON: three.js values become arrays and hex,
 * nodes, components and systems become the summary `telemetry` gives, and anything deeper than
 * a few levels is cut, so returning `scene` by accident does not serialize the world.
 */
function plain(value: unknown, depth = 0): unknown {
  if (value === undefined || value === null) return null;
  if (['number', 'string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'function') return `[function ${(value as Function).name}]`;
  if (value instanceof Vector2 || value instanceof Vector3 || value instanceof Vector4) return value.toArray();
  if (value instanceof Quaternion) return value.toArray();
  if (value instanceof Color) return `#${value.getHexString()}`;
  if (depth > 3) return '…';
  if (Array.isArray(value)) return value.map((item) => plain(item, depth + 1));
  if (value instanceof Map) return plain([...value.entries()], depth + 1);
  if (value instanceof Set) return plain([...value], depth + 1);
  if (value instanceof Component) {
    return { type: value.constructor.name, enabled: value.enabled, ...readable(value) };
  }
  if (value instanceof System) return { type: value.constructor.name, ...readable(value, System) };
  const node = value as Partial<Object3D>;
  if (node.isObject3D) {
    return {
      type: node.type,
      name: node.name,
      position: node.position!.toArray(),
      eulerAngles: node.eulerAngles!.toArray(),
      visible: node.visible,
      active: node.activeInHierarchy,
      components: node.components!.map((component) => component.constructor.name),
    };
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key.startsWith('_') || typeof item === 'function') continue;
      out[key] = plain(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

/**
 * A scene that holds one instance of a prefab — the stage a prefab is edited on.
 *
 * The lights and the background are the tool's, not the document's, so they carry the
 * `scenocoToolOnly` flag every other tool-drawn helper does: `outline`, picking and
 * framing all skip them, and nothing the person sees in the tree came from anywhere but the
 * prefab they opened.
 */
function stageFor(Prefab: PrefabType<Object3D>): SceneType {
  return class PrefabStage extends Scene {
    override onLoad(): void {
      this.instantiate(Prefab);
      this.background = new Color(0x15181f);
      for (const light of [ambient(), key()]) {
        light.userData.scenocoToolOnly = true;
        this.add(light);
      }
    }
  };
}

function ambient(): AmbientLight {
  return new AmbientLight(0xffffff, 0.6);
}

function key(): DirectionalLight {
  const light = new DirectionalLight(0xffffff, 2);
  light.position.set(3, 5, 4);
  return light;
}

/**
 * The component and system classes a live scene is running, by class name — the names a snippet
 * reaches for. A name two classes share is left out rather than guessed between.
 */
function classesIn(scene: Scene): Record<string, Function> {
  const byName = new Map<string, Function | null>();
  const note = (type: Function): void => {
    const name = type.name;
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) return;
    const known = byName.get(name);
    if (known === undefined) byName.set(name, type);
    else if (known !== type) byName.set(name, null);
  };
  scene.traverse((node) => {
    for (const component of node.components) note(component.constructor);
  });
  for (const system of scene.systems) note(system.constructor);
  return Object.fromEntries([...byName].filter((entry): entry is [string, Function] => entry[1] !== null));
}
