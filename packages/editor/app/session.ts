import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Camera,
} from 'three';
import { Engine, Input, SceneManager, type PrefabType, type SceneType } from '@scenoco-three/core';
import type { PreviewFrame, SimStep } from '../src/protocol.js';

export type EditorMode = 'edit' | 'play';

/** Where to point the editor camera and how far back to sit — what framing works out. */
export interface FocusTarget {
  center: Vector3;
  distance: number;
}

/**
 * The live scene, and everything that can be done to it.
 *
 * Two modes, and the difference is only who drives. In **edit** the scene is loaded but not
 * ticked, and an editor camera flies around it; in **play** the scene's own `mainCamera` renders
 * and `SceneManager` ticks. Both look at the same objects — there is no separate preview build,
 * which is what makes "it looked right in the editor" mean something.
 */
export class EditorSession {
  readonly canvas: HTMLCanvasElement;
  /**
   * A real core `Engine`, with its frame loop left stopped.
   *
   * The editor drives `SceneManager` itself, so it needs none of the loop — but it does need to
   * *be* the host, because a system reaches the renderer through `Engine.current`. Building a
   * bare `WebGLRenderer` instead left that null, and the symptom was a scene whose `<Canvas>` HUD
   * simply never appeared: `UIRenderer` had nothing to size the screen with and skipped it, with
   * nothing anywhere saying why.
   */
  readonly engine: Engine;
  readonly renderer: WebGLRenderer;
  /** The camera the editor flies. Edit mode renders through it. */
  readonly editorCamera: PerspectiveCamera;

  scene: Scene | null = null;
  mode: EditorMode = 'edit';
  playing = false;
  /** The class the open module exports, so the scene can be rebuilt from scratch. */
  private sceneClass: SceneType | null = null;
  /** Raised whenever the loaded scene is replaced, so the host can rebind to it. */
  onChange: (() => void) | null = null;

  /** One editor-owned stand-in per scene camera, for the UI overlay pass. */
  private readonly overlays = new WeakMap<Camera, Camera>();
  private showUi = false;

  private clock = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // Constructed, never started: `Engine` owns the renderer, input and canvas sizing, and the
    // editor owns the frame loop.
    this.engine = new Engine({ canvas, container: canvas.parentElement ?? document.body });
    this.renderer = this.engine.renderer;
    this.editorCamera = new PerspectiveCamera(50, 1, 0.1, 2000);
    this.editorCamera.position.set(6, 5, 10);
    this.editorCamera.lookAt(0, 0, 0);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /**
   * Load a document from its generated module.
   *
   * The same module the game imports, served straight out of the project — so the editor is
   * looking at the real thing rather than at a rendering of a description of it.
   *
   * A scene loads as itself. A prefab is a node, not a scene, so it opens on a stage: an
   * otherwise empty scene holding one instance of it, lit well enough to see. That is Unity's
   * prefab mode, and it is the only way a document whose root is a `Mesh` can be looked at at
   * all — the alternative is finding a scene that happens to spawn one.
   */
  async open(moduleUrl: string): Promise<void> {
    await SceneManager.unloadAll();
    const module = (await import(/* @vite-ignore */ moduleUrl)) as Record<string, unknown>;
    const exported = Object.values(module).filter((value): value is new () => object => typeof value === 'function');
    const SceneClass = exported.find(
      (value): value is SceneType => Scene.prototype.isPrototypeOf(value.prototype),
    );
    const PrefabClass = exported.find(
      (value): value is PrefabType<Object3D> => Object3D.prototype.isPrototypeOf(value.prototype),
    );
    if (!SceneClass && !PrefabClass) throw new Error(`${moduleUrl} exports no scene or prefab class`);

    this.sceneClass = SceneClass ?? stageFor(PrefabClass!);
    this.scene = await SceneManager.load(this.sceneClass);
    this.resize(); // the scene's camera only exists now, and it is the one play mode renders through
    this.onChange?.();
  }

  // --- the scene's UI, while editing ---------------------------------------------------------

  /**
   * Whether the editor draws the scene's screen-space UI over the viewport.
   *
   * A `<Canvas>` is a child of the *scene's* camera and sizes itself to it, so from the editor
   * camera a HUD is a small rectangle floating in world space near a camera you are usually
   * looking away from. Play mode has been the only place it is legible, which makes laying one
   * out a matter of pressing Play, looking, pressing Stop.
   *
   * Switching this on draws it in a second pass instead: a camera matching the one the UI was
   * built for, over the top of the finished frame, clearing nothing. Nothing about the scene
   * graph changes — the Canvas stays the child of its camera, where the document put it and
   * where the hierarchy shows it.
   */
  get uiInEditor(): boolean {
    return this.showUi;
  }

  set uiInEditor(on: boolean) {
    this.showUi = on;
  }

  /**
   * Draw the UI over the finished frame.
   *
   * `render` takes any `Object3D` as its root, so passing the UI root draws that subtree and
   * nothing else — no layer masks to keep in step as uikit builds and drops meshes during
   * layout, and no second copy of the scene.
   *
   * The camera is a copy rather than the scene's own. A render pass writes to the camera it is
   * given — `matrixWorldInverse`, the projection matrix — and an editor-only overlay has no
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

  /** A stand-in for one of the scene's cameras, kept in step with it and owned by the editor. */
  private overlayFor(owner: Camera): Camera {
    let copy = this.overlays.get(owner);
    if (!copy) {
      copy = owner.clone(false) as Camera; // no children: the UI subtree is rendered, not copied
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
   * a project that uses no UI must not drag the package in, and the editor has no business
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
  }

  pause(): void {
    this.playing = false;
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
    this.mode = 'edit';
    if (!this.sceneClass) return;
    await SceneManager.unloadAll();
    this.scene = await SceneManager.load(this.sceneClass);
    this.resize(); // a rebuilt scene brings a fresh camera with a default aspect
    this.clock = 0;
    SceneManager.resetFrameClock();
    this.onChange?.();
  }

  /** Advance by exactly one step — the frame-by-frame inspection a bug needs. */
  step(dt = 1 / 60): void {
    this.clock += dt * 1000;
    SceneManager.tick(this.clock);
    Input.endFrame();
  }

  /**
   * One frame of the editor's own loop.
   *
   * `Input.endFrame` runs whether or not the scene stepped, and that is the point: `Engine` calls
   * it from the loop the editor does not use, so nothing else would. Without it `getKeyDown` is
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
    this.renderer.render(this.scene, camera);
    // Only in edit mode: play renders through the scene's own camera, where the UI is already
    // in front of it, and a run has to show exactly what the game shows — once.
    if (this.showUi && this.mode === 'edit') this.renderUiOverlay();
  }

  /** Play renders through the scene's camera; edit through the editor's. */
  renderCamera(): Camera {
    return this.mode === 'play' && this.scene?.mainCamera ? this.scene.mainCamera : this.editorCamera;
  }

  /**
   * Match the drawing buffer and **both** cameras to the canvas.
   *
   * `Engine.resize` sizes the buffer and the scene's camera, and it is the very code the game
   * runs — so it is called rather than reimplemented. But the editor never starts the engine's
   * loop, which is what would normally keep calling it: the constructor's one call happens before
   * any scene is loaded, so `mainCamera` does not exist yet and never gets an aspect. Play mode
   * then renders the game through a camera still at aspect 1 and every sphere is an ellipse.
   *
   * The editor's own camera is not the engine's business, so it is handled here.
   */
  private resize(): void {
    this.engine.resize();
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.editorCamera.aspect = w / Math.max(h, 1);
    this.editorCamera.updateProjectionMatrix();
  }

  /**
   * Put the editor camera where it can see everything, and say what to look at.
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
    const box = new Box3();
    for (const child of this.scene.children) {
      if (child.userData.scenocoEditorOnly) continue;
      box.union(new Box3().setFromObject(child));
    }
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
    const fit = radius / Math.sin((this.editorCamera.fov * Math.PI) / 360);
    return { center, distance: fit * 1.2 }; // a fifth of a radius of air around the subject
  }

  // --- what an agent asks for ---------------------------------------------------------------

  /**
   * Render one PNG from an arbitrary viewpoint.
   *
   * A capture camera rather than the editor's own: a shot must not move what the person at the
   * keyboard is looking at, and two shots of the same run have to be comparable.
   */
  preview(frame: PreviewFrame, at: string, lookAt?: string): string {
    if (!this.scene) throw new Error('no scene is open');

    const usingScene = frame.ui && this.scene.mainCamera;
    const camera = usingScene
      ? (this.scene.mainCamera as PerspectiveCamera)
      : new PerspectiveCamera(50, frame.width / frame.height, 0.1, 2000);

    const previous = {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      aspect: camera.aspect,
    };
    const target = pointOf(lookAt) ?? new Vector3();
    const eye = at === 'fit' ? this.fitPoint(camera, target) : pointOf(at);
    if (!eye) throw new Error(`camera="${at}" is not a point — write "y: 6; z: 12", or "fit"`);
    camera.position.copy(eye);
    camera.lookAt(target);
    // Always, including the scene's own camera: it is framed for the editor viewport, and
    // rendering it into a differently-shaped buffer stretches everything in the shot.
    camera.aspect = frame.width / frame.height;
    camera.updateProjectionMatrix();

    const { width, height } = this.renderer.domElement;
    this.renderer.setSize(frame.width, frame.height, false);
    this.renderer.render(this.scene, camera);
    const dataUrl = this.canvas.toDataURL('image/png');
    this.renderer.setSize(width, height, false);

    // Put the camera back: a capture is an observation, and an observation that moves the thing
    // it observed is not one.
    camera.position.copy(previous.position);
    camera.quaternion.copy(previous.quaternion);
    camera.aspect = previous.aspect;
    camera.updateProjectionMatrix();
    return dataUrl;
  }

  /** A viewpoint that fits the whole scene, for `camera="fit"`. */
  private fitPoint(camera: PerspectiveCamera, target: Vector3): Vector3 {
    const box = new Box3().setFromObject(this.scene!);
    const center = box.isEmpty() ? new Vector3() : box.getCenter(new Vector3());
    target.copy(center);
    const radius = box.isEmpty() ? 5 : Math.max(box.getSize(new Vector3()).length() / 2, 0.5);
    const distance = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.2;
    return center.clone().addScaledVector(new Vector3(0.6, 0.5, 1).normalize(), distance);
  }

  /**
   * Read the state at an `id` the document declared.
   *
   * The generated scene class carries a typed field per `id`, so this is a property lookup —
   * there is no registry to consult and no name index to keep.
   */
  telemetry(id: string): unknown {
    const node = (this.scene as unknown as Record<string, Object3D | undefined>)?.[id];
    if (!node || typeof node !== 'object' || !('isObject3D' in node)) {
      throw new Error(`no id "${id}" in this document`);
    }
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

  /** Run a batch of steps in order, collecting whatever each one produced. */
  async simulate(
    steps: readonly SimStep[],
    frame: PreviewFrame,
  ): Promise<Array<{ kind: 'image' | 'json'; value: unknown }>> {
    const out: Array<{ kind: 'image' | 'json'; value: unknown }> = [];
    for (const step of steps) {
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
          for (let i = 0; i < (step.frames ?? 1); i++) this.step(step.dt ?? 1 / 60);
          break;
        case 'press':
          this.key('keydown', step.key);
          this.step();
          this.key('keyup', step.key);
          break;
        case 'keyDown':
          this.key('keydown', step.key);
          break;
        case 'keyUp':
          this.key('keyup', step.key);
          break;
        case 'click':
          this.pointer('pointerdown', step.x, step.y, step.button);
          this.pointer('pointerup', step.x, step.y, step.button);
          break;
        case 'move':
          this.pointer('pointermove', step.x, step.y);
          break;
        case 'preview':
          out.push({ kind: 'image', value: this.preview(frame, step.camera, step.lookAt) });
          break;
        case 'telemetry':
          out.push({ kind: 'json', value: this.telemetry(step.id) });
          break;
      }
    }
    return out;
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

/** `"y: 6; z: 12"` — the document's own vector grammar, so an agent learns one. */
export function pointOf(text?: string): Vector3 | undefined {
  if (!text || text === 'fit') return undefined;
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

/**
 * A `KeyCode` member name as the DOM spells it.
 *
 * `Space` is `Space`, `W` is `KeyW`, `LeftArrow` is `ArrowLeft` — one small table, because the
 * two vocabularies genuinely differ and an agent should write the one the engine documents.
 */
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

/** A component's own public values — what a document could have written, read back. */
function readable(component: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(component)) {
    if (key.startsWith('_')) continue;
    if (value === null || ['number', 'string', 'boolean'].includes(typeof value)) out[key] = value;
    else if (value instanceof Vector3) out[key] = value.toArray();
  }
  return out;
}

/**
 * A scene that holds one instance of a prefab — the stage a prefab is edited on.
 *
 * The lights and the background are the editor's, not the document's, so they carry the
 * `scenocoEditorOnly` flag every other editor-drawn helper does: the hierarchy, picking and
 * framing all skip them, and nothing the person sees in the tree came from anywhere but the
 * prefab they opened.
 */
function stageFor(Prefab: PrefabType<Object3D>): SceneType {
  return class PrefabStage extends Scene {
    override onLoad(): void {
      this.instantiate(Prefab);
      this.background = new Color(0x15181f);
      for (const light of [ambient(), key()]) {
        light.userData.scenocoEditorOnly = true;
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
