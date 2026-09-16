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
import { Engine, SceneManager, type PrefabType, type SceneType } from '@scenoco-three/core';

/** Where to point the editor camera and how far back to sit — what framing works out. */
export interface FocusTarget {
  center: Vector3;
  distance: number;
}

/**
 * The live scene, and everything that can be done to it.
 *
 * The scene is loaded but not ticked, and an editor camera flies around it. It is the same objects
 * the game builds — there is no separate preview build, which is what makes "it looked right in
 * the editor" mean something.
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
  /** The class the open module exports, so the scene can be rebuilt from scratch. */
  private sceneClass: SceneType | null = null;
  /** Raised whenever the loaded scene is replaced, so the host can rebind to it. */
  onChange: (() => void) | null = null;

  /** One editor-owned stand-in per scene camera, for the UI overlay pass. */
  private readonly overlays = new WeakMap<Camera, Camera>();
  private showUi = false;

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
  async open(SceneClass: SceneType): Promise<void> {
    await SceneManager.unloadAll();
    this.scene = await SceneManager.load(SceneClass);
    this.resize();

    // One draw to make the scene's render settings current — which is what asks for the post
    // chain — then wait for it. Without this the first `screenshot` after opening shows no post
    // passes, because the composer is a dynamic import that has not landed yet, and "no bloom"
    // is indistinguishable from "the <Bloom> I just wrote does not work".
    this.render();
    await this.engine.effectsReady();

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
   * One frame of a scene that is not running.
   *
   * Nothing is simulated here — this editor has no play mode, because behaviour is a project's
   * TypeScript and this page has none. What still has to happen per frame is presentation: a UI
   * layout is arithmetic over the current state, and a system that can bring itself up to date
   * without simulating says so with `layout`.
   */
  frame(dt: number): void {
    for (const system of this.scene?.systems ?? []) system.layout?.(dt);
    this.render();
  }

  render(): void {
    if (!this.scene) return;
    // Through the engine, not `renderer.render`: the scene's render document — tone mapping,
    // bloom, vignette, fog — is applied there, and a viewport that skips it is not showing the
    // scene the game draws.
    this.engine.renderScene(this.scene, this.editorCamera);
    if (this.showUi) this.renderUiOverlay();
  }

  /**
   * Match the drawing buffer and **both** cameras to the canvas.
   *
   * `Engine.resize` sizes the buffer and the scene's camera, and it is the very code the game
   * runs — so it is called rather than reimplemented. But the editor never starts the engine's
   * loop, which is what would normally keep calling it: the constructor's one call happens before
   * any scene is loaded, so `mainCamera` does not exist yet and never gets an aspect; the UI
   * overlay borrows that camera, and would draw through one at aspect 1.
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
    const fit = radius / Math.sin((this.editorCamera.fov * Math.PI) / 360);
    return { center, distance: fit * 1.2 }; // a fifth of a radius of air around the subject
  }

  // --- what an agent asks for ---------------------------------------------------------------


}

/** `"y: 6; z: 12"` — the document's own vector grammar, so an agent learns one. */
/**
 * The bounds of what the *document* authored.
 *
 * The editor draws into the same scene the game does — the gizmo's helper is a child of it, and
 * that helper carries a 100000-unit picker plane. Every question of the form "where should the
 * camera go to see this?" has to ask about the authored children alone, or it answers about the
 * gizmo. There is one of these because there were two, and only one of them had the filter.
 */
export function boxOfAuthored(scene: Scene): Box3 {
  const box = new Box3();
  for (const child of scene.children) {
    if (child.userData.scenocoToolOnly) continue;
    box.union(new Box3().setFromObject(child));
  }
  return box;
}



/**
 * A scene that holds one instance of a prefab — the stage a prefab is edited on.
 *
 * The lights and the background are the editor's, not the document's, so they carry the
 * `scenocoToolOnly` flag every other tool-drawn helper does: the hierarchy, picking and
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
