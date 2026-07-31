import {
  AmbientLight, Box3, Color, DirectionalLight, PerspectiveCamera, Sphere, Vector3, type Object3D,
} from 'three';
import { Engine, PrefabAsset, Registry, bundleKind, type Bundle, type Component } from '@scenoco-three/core';
import type { SceneProvenance } from '@scenoco-three/compiler';
import type { EditOp, EditorResult, NodeRef, SimStep, StructuralOp } from '../src/protocol.js';
import { SceneDocument } from './document.js';
import { componentName, isEditorOnly, registeredMeta, round, toDeg } from './meta.js';

export type EditorMode = 'edit' | 'play';

/**
 * Owns the engine and the edit ⇄ play lifecycle. In **edit** mode the scene shows
 * its authored pose through an editor-controlled camera (Engine `editor:true`); in
 * **play** mode a fresh `editor:false` engine runs the real gameplay through the
 * scene's own camera. The engine is recreated on each switch.
 */
export class EditorSession {
  engine: Engine;
  mode: EditorMode = 'edit';
  playing = false;
  /** The editor camera (edit mode only). */
  editorCamera?: PerspectiveCamera;
  /** A reused framing camera for play-mode previews of scenes/prefabs that have no camera of their own. */
  private previewCamera?: PerspectiveCamera;
  /** Fired after the engine/scene changes, so the host rebinds camera + panels. */
  onChange?: () => void;
  /** Fired when a watched file changes on disk (the open file or a `src=` dep). */
  onExternalChange?: (file: string, role: 'open' | 'dep') => void;
  /**
   * A project component file changed. Picking up new `@property` metadata needs a
   * full page reload (re-importing the module would re-run its decorator), which
   * discards unsaved scene edits — so the host decides, rather than reloading here.
   * `metaChanged` is true when the registered property surface actually moved.
   */
  onComponentsChanged?: (metaChanged: boolean) => void;
  /**
   * Fired when a gameplay frame throws (a component hook / system error). The host
   * shows it in the same "component code has an error" banner; the session stays
   * alive (playback paused) so a fix + HMR reload recovers, rather than the RAF
   * loop dying or the MCP session wedging.
   */
  onRuntimeError?: (message: string) => void;

  private bundle?: Bundle;
  /**
   * The unsaved inspector edits, overlaid onto freshly-instantiated **play/preview**
   * engines so gameplay reflects them even before a save (edit mode already shows
   * them via the live SceneDocument). The host keeps this in sync with the document's
   * net edits, and re-applies it after a stop to restore the edit view.
   */
  private edits: EditOp[] = [];
  /** Structural op-log (reparent/remove) overlaid onto play/preview engines, like `edits`. */
  private structural: StructuralOp[] = [];
  /** Source path of the open scene/prefab — the target of `save`. */
  filePath?: string;
  /** Editor provenance for the open file (prefab/material origins), for the document. */
  provenance?: SceneProvenance;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.engine = this.makeEngine(true);
  }

  private makeEngine(editor: boolean): Engine {
    return new Engine({ canvas: this.canvas, autoStart: false, editor, preserveDrawingBuffer: true });
  }

  /** The current unsaved edit overlay — the host re-applies it after a stop to restore the edit view. */
  get pendingEdits(): EditOp[] {
    return this.edits;
  }
  /** Keep the play/preview overlay in sync with the document's net edits. */
  setEdits(edits: EditOp[]): void {
    this.edits = edits;
  }
  /** Keep the play/preview structural overlay in sync with the document's op-log. */
  setStructural(ops: StructuralOp[]): void {
    this.structural = ops;
  }
  /** The current structural op-log — the host replays it onto the edit engine after a stop. */
  get pendingStructural(): StructuralOp[] {
    return this.structural;
  }

  /** Fetch + load a scene/prefab (edit mode). Returns a small summary. */
  async open(path: string): Promise<{ file: string; kind: 'scene' | 'prefab'; nodes: number; componentError?: string }> {
    this.edits = []; // a freshly loaded file starts with no overlay (the doc is rebuilt clean)
    this.structural = [];
    const res = await fetch(`/@scenoco/bundle?file=${encodeURIComponent(path)}`);
    const data = (await res.json()) as
      | { bundle: Bundle; provenance: SceneProvenance; componentError?: string }
      | { error: string; componentError?: string };
    if (!res.ok || !('bundle' in data) || !Array.isArray(data.bundle)) {
      const message = (data as { error?: string }).error ?? 'failed to open file';
      const componentError = (data as { componentError?: string }).componentError;
      throw new Error(componentError ? `${message}\n\n${componentError}` : message);
    }
    this.bundle = data.bundle;
    this.provenance = data.provenance;
    this.filePath = path;
    this.toEdit();
    const summary = { file: path, kind: bundleKind(this.bundle) === 'prefab' ? ('prefab' as const) : ('scene' as const), nodes: count(this.engine.scene) };
    return data.componentError ? { ...summary, componentError: data.componentError } : summary;
  }

  /** Write attribute edits + structural ops back to the source file (comment-preserving). */
  async save(edits: EditOp[], structuralOps: StructuralOp[] = []): Promise<{ changed: number; unresolved: number }> {
    if (!this.filePath) throw new Error('no file open to save');
    const res = await fetch('/@scenoco/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: this.filePath, edits, structuralOps }),
    });
    const data = (await res.json()) as { changed: number; unresolved: number; error?: string };
    if (!res.ok) throw new Error(data.error ?? 'save failed');
    // Pick up the recompiled bundle from the just-saved XML so play/stop run the
    // saved scene — without re-instantiating the live edit engine (no camera/
    // selection reset). The doc is marked saved by the host, clearing the overlay.
    await this.refreshBundle();
    return data;
  }

  /** Re-fetch the compiled bundle for the open file (after a save), updating the play baseline. */
  private async refreshBundle(): Promise<void> {
    if (!this.filePath) return;
    try {
      const res = await fetch(`/@scenoco/bundle?file=${encodeURIComponent(this.filePath)}`);
      const data = (await res.json()) as { bundle?: Bundle };
      if (res.ok && Array.isArray(data.bundle)) this.bundle = data.bundle;
    } catch {
      /* keep the current baseline — worst case play uses the pre-save bundle until next open */
    }
  }

  /** Start (or resume) gameplay. */
  run(): void {
    if (this.mode === 'play') {
      this.playing = true; // resume from pause
      return;
    }
    this.swap(false);
    this.playing = true;
    this.onChange?.();
  }
  pause(): void {
    this.playing = false;
  }
  /** Advance gameplay by a single frame while paused (no-op outside play mode). */
  step(dt = 1 / 60): void {
    if (this.mode !== 'play') return;
    this.runTick(dt); // bypass the play+paused gate in tick()
  }
  stop(): void {
    this.toEdit();
  }

  /** Advance one frame: edit always renders; play advances only while playing. */
  tick(dt: number): void {
    this.runTick(this.mode === 'play' && !this.playing ? 0 : dt);
  }

  /**
   * Drive the engine one frame, catching any error a component hook / system
   * throws so a single bad frame can't kill the RAF loop or the MCP session.
   * On failure it pauses playback (so the failing frame isn't re-run every RAF)
   * and surfaces the error to the host banner. Returns the error message, if any.
   */
  private runTick(dt: number): string | undefined {
    try {
      this.engine.tick(dt);
      return undefined;
    } catch (e) {
      this.playing = false;
      const message = e instanceof Error ? (e.stack ?? e.message) : String(e);
      this.onRuntimeError?.(message);
      return message;
    }
  }

  /** Capture the current view as a PNG data URL (optionally re-framing the editor camera). */
  preview(opts: { camera?: string; lookAt?: string }): string {
    if (this.mode === 'edit') {
      if (this.editorCamera) {
        const cam = vec3(opts.camera);
        const look = vec3(opts.lookAt);
        if (cam) this.editorCamera.position.copy(cam);
        if (look) this.editorCamera.lookAt(look);
      }
      // Particles only emit under their play-mode render system — render a short
      // throwaway play burst so a VFX prefab isn't previewed empty while authoring.
      if (this.hasParticles()) return this.particlePreview(opts);
    } else {
      // Play mode: honor the camera override (P2) and give a camera-less lone prefab
      // a default framed camera + backdrop, so it isn't a blank white frame.
      this.framePlayPreview(opts);
    }
    this.runTick(0); // render the current frame (guarded — a bad frame won't wedge the session)
    return this.canvas.toDataURL('image/png');
  }

  /** Current property values at a scene id — see {@link telemetryFor}. */
  telemetry(id: string): unknown {
    return telemetryFor(this.engine, id);
  }

  /**
   * Execute a batch of player-simulation steps in order against the live engine —
   * transport, frame stepping, synthetic key/mouse/gamepad input, and preview/
   * telemetry captures. Runs synchronously (no real-time loop interleaves), so an
   * agent can drive the game to a precise condition and sample it there. Injected
   * input is committed on the next `step`, so the usual order is input → step →
   * preview/telemetry. Returns the captures in step order.
   */
  simulate(steps: SimStep[]): EditorResult[] {
    const out: EditorResult[] = [];
    for (const step of steps) {
      const input = this.engine.input;
      switch (step.do) {
        case 'play':
          this.run();
          break;
        case 'pause':
          this.pause();
          break;
        case 'stop':
          this.stop();
          break;
        case 'step': {
          const frames = Math.max(0, Math.floor(step.frames ?? 1));
          const dt = step.dt ?? 1 / 60;
          for (let i = 0; i < frames; i++) {
            // A throwing frame surfaces as a result (not a bare transport error)
            // and stops the batch, leaving the session alive for the agent to inspect.
            const error = this.runTick(dt);
            if (error) { out.push({ kind: 'json', data: { error } }); return out; }
          }
          break;
        }
        case 'tap':
          input.injectKey(step.key, true);
          input.injectKey(step.key, false);
          break;
        case 'keyDown':
          input.injectKey(step.key, true);
          break;
        case 'keyUp':
          input.injectKey(step.key, false);
          break;
        case 'click': {
          if (step.x !== undefined && step.y !== undefined) input.injectMouseMove(step.x, step.y);
          const b = step.button === 'right' ? 1 : step.button === 'middle' ? 2 : 0;
          input.injectMouseButton(b, true);
          input.injectMouseButton(b, false);
          break;
        }
        case 'move':
          input.injectMouseMove(step.x ?? 0, step.y ?? 0, step.dx ?? 0, step.dy ?? 0);
          break;
        case 'gamepad':
          input.injectGamepad(step.index ?? 0, { ...(step.buttons ? { buttons: step.buttons } : {}), ...(step.axes ? { axes: step.axes } : {}) });
          break;
        case 'preview':
          out.push({ kind: 'image', dataUrl: this.preview({ ...(step.camera ? { camera: step.camera } : {}), ...(step.lookAt ? { lookAt: step.lookAt } : {}) }) });
          break;
        case 'telemetry':
          out.push({ kind: 'json', data: this.telemetry(step.id) });
          break;
      }
    }
    return out;
  }

  // ── internals ────────────────────────────────────────────────────────────────

  private toEdit(): void {
    this.swap(true);
    this.mode = 'edit';
    this.playing = false;
    this.editorCamera = this.frameCamera();
    this.onChange?.();
  }

  private swap(editor: boolean): void {
    this.engine.dispose();
    this.engine = this.makeEngine(editor);
    this.editorCamera = undefined;
    this.mode = editor ? 'edit' : 'play';
    this.applyBundle();
  }

  private applyBundle(): void {
    if (!this.bundle) return;
    applyBundleToEngine(this.engine, this.bundle);
    // Play/preview run the *edited* scene: overlay the current unsaved edits onto the
    // fresh instances. Edit mode is skipped — its live SceneDocument applies edits
    // through the real document instead, so undo/dirty state stays correct.
    if (this.mode !== 'edit') {
      this.applyStructuralOverlay(this.engine);
      this.applyEditOverlay(this.engine);
    }
  }

  /** Re-apply the unsaved edit overlay onto a freshly-instantiated engine (play/preview). */
  private applyEditOverlay(engine: Engine): void {
    if (this.edits.length === 0) return;
    const graph = engine.getSceneGraph();
    if (graph) new SceneDocument(graph, this.provenance).applyEdits(this.edits);
  }

  /**
   * Reparent/remove nodes on a fresh engine to match the structural op-log, so
   * play/preview reflect unsaved reparents. `insertNode` needs the compiler, so it
   * only shows after a save (recompile) — see the docs. Resolves nodes by id/path.
   */
  private applyStructuralOverlay(engine: Engine): void {
    for (const op of this.structural) {
      if (op.op === 'moveNode') {
        const node = resolveInEngine(engine, op.target);
        const parent = op.parent.path?.length === 0 ? engine.scene : resolveInEngine(engine, op.parent);
        if (node && parent) parent.add(node);
      } else if (op.op === 'removeNode') {
        resolveInEngine(engine, op.target)?.removeFromParent();
      } else if (op.op === 'insertNode') {
        // A pasted subtree: spawn the fragment live (no recompile) — the same
        // roundtrip-free path the edit engine uses, so play/preview match.
        const parent = op.parent.path?.length === 0 ? engine.scene : resolveInEngine(engine, op.parent);
        if (parent) engine.spawnSubtree(op.fragment, parent, op.index);
      }
    }
  }

  /** Editor camera framing the scene from a 3/4 angle. */
  private frameCamera(): PerspectiveCamera {
    const cam = new PerspectiveCamera(50, this.canvas.clientWidth / this.canvas.clientHeight || 1, 0.01, 50000);
    frameCameraTo(cam, this.engine.scene);
    this.engine.mainCamera = cam;
    return cam;
  }

  /** Any live `ParticleSystem` component in the scene — VFX that only emits under its play-mode render system. */
  private hasParticles(): boolean {
    const ctor = Registry.getComponent('ParticleSystem')?.ctor;
    return ctor ? this.engine.getComponentsOfType(ctor).length > 0 : false;
  }

  /**
   * Frame a preview for the current play scene: honor a `camera`/`lookAt` override
   * (P2 — worked only in edit mode before), and give a scene with no camera of its
   * own (a lone prefab) a default framed camera + neutral backdrop so it isn't a
   * blank white frame. Left untouched when the scene has its own camera and no override.
   */
  private framePlayPreview(opts: { camera?: string; lookAt?: string }): void {
    const camPos = vec3(opts.camera);
    const lookAt = vec3(opts.lookAt);
    if (this.engine.mainCamera && !camPos && !lookAt) return; // scene's own camera, no override — leave it
    const cam = (this.previewCamera ??= new PerspectiveCamera(50, 1, 0.01, 50000));
    cam.aspect = this.canvas.clientWidth / this.canvas.clientHeight || 1;
    const center = frameCameraTo(cam, this.engine.scene); // auto-frame, then apply any override
    if (camPos) cam.position.copy(camPos);
    if (lookAt) cam.lookAt(lookAt);
    else if (camPos) cam.lookAt(center);
    cam.updateProjectionMatrix();
    this.engine.mainCamera = cam; // not one of the scene's cameras → a render override
    if (!this.engine.scene.background) this.engine.scene.background = new Color(0x15181f);
  }

  /**
   * Render a particle-bearing file in a throwaway play engine advanced a few
   * frames, so its VFX is actually visible when previewed while authoring (in edit
   * mode the particle render system never runs, so the effect shows empty). The
   * edit session's own engine is left untouched; the next frame re-renders it.
   */
  private particlePreview(opts: { camera?: string; lookAt?: string }): string {
    const engine = new Engine({ canvas: this.canvas, autoStart: false, editor: false, preserveDrawingBuffer: true });
    try {
      if (this.bundle) applyBundleToEngine(engine, this.bundle);
      this.applyEditOverlay(engine); // preview unsaved edits too
      const cam = new PerspectiveCamera(50, this.canvas.clientWidth / this.canvas.clientHeight || 1, 0.01, 50000);
      const center = frameCameraTo(cam, engine.scene);
      const camPos = vec3(opts.camera);
      const lookAt = vec3(opts.lookAt);
      if (camPos) cam.position.copy(camPos);
      if (lookAt || camPos) cam.lookAt(lookAt ?? center);
      cam.updateProjectionMatrix();
      engine.mainCamera = cam;
      for (let i = 0; i < PARTICLE_PREVIEW_FRAMES; i++) engine.tick(1 / 60);
      return this.canvas.toDataURL('image/png');
    } finally {
      engine.dispose();
    }
  }
}

/** Resolve a NodeRef to a live object in `engine`: by `id`, else by structural path. */
export function resolveInEngine(engine: Engine, ref: NodeRef): Object3D | undefined {
  if (ref.id !== undefined) return engine.findObject(ref.id) ?? undefined;
  if (!ref.path) return undefined;
  let cur: Object3D = engine.scene;
  for (const ordinal of ref.path) {
    const next = cur.children.filter((c) => !isEditorOnly(c))[ordinal];
    if (!next) return undefined;
    cur = next;
  }
  return cur;
}

/** Frames to advance a particle preview so the effect has visibly emitted. */
const PARTICLE_PREVIEW_FRAMES = 30;

/** Instantiate a bundle into `engine`: a prefab gets neutral preview lights + backdrop; a scene loads as-is. */
function applyBundleToEngine(engine: Engine, bundle: Bundle): void {
  if (bundleKind(bundle) === 'prefab') {
    engine.instantiate(bundle);
    // Editor-only preview lights — flagged so the Hierarchy/picking ignore them.
    const ambient = new AmbientLight(0xffffff, 0.6);
    ambient.userData.scenocoEditorOnly = true;
    engine.scene.add(ambient);
    const key = new DirectionalLight(0xffffff, 2);
    key.position.set(3, 5, 4);
    key.userData.scenocoEditorOnly = true;
    engine.scene.add(key);
    if (!engine.scene.background) engine.scene.background = new Color(0x15181f);
  } else {
    engine.loadScene(bundle);
  }
}

/** Position `cam` to frame `scene` from a 3/4 angle; returns the scene center it looks at. */
function frameCameraTo(cam: PerspectiveCamera, scene: Object3D): Vector3 {
  const box = new Box3().setFromObject(scene);
  const sphere = box.isEmpty() ? new Sphere(new Vector3(), 1) : box.getBoundingSphere(new Sphere());
  const center = sphere.center;
  const radius = sphere.radius || 1;
  cam.position.copy(center).addScaledVector(new Vector3(0.6, 0.45, 1).normalize(), (radius / Math.sin((50 * Math.PI) / 180 / 2)) * 1.2);
  cam.lookAt(center);
  return center;
}

// ── value helpers (telemetry → JSON) ─────────────────────────────────────────────

function propValues(component: Component): Record<string, unknown> {
  const meta = registeredMeta(component);
  const out: Record<string, unknown> = {};
  if (!meta) return out;
  for (const [name] of meta.properties) out[name] = jsonValue((component as unknown as Record<string, unknown>)[name]);
  return out;
}
function jsonValue(v: unknown): unknown {
  if (v == null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v ?? null;
  if (Array.isArray(v)) return v.map(jsonValue);
  if (v instanceof PrefabAsset) return v.describe(); // a `prefab` prop → its label, not "[object Object]"
  const o = v as { isVector3?: boolean; isVector2?: boolean; isColor?: boolean; isEuler?: boolean; isObject3D?: boolean; x?: number; y?: number; z?: number; sceneId?: string; getHexString?: () => string };
  if (o.isVector3) return [o.x, o.y, o.z];
  if (o.isVector2) return [o.x, o.y];
  if (o.isEuler) return [toDeg(o.x!), toDeg(o.y!), toDeg(o.z!)];
  if (o.isColor) return `#${o.getHexString!()}`;
  if (o.isObject3D) return o.sceneId || '(node)';
  // A component reference → its scene #id (what the agent correlates on), falling
  // back to the class name only when the target has no id.
  if ('node' in (o as object) && 'engine' in (o as object)) {
    const c = v as Component;
    return c.id !== undefined ? `#${c.id}` : (componentName(c) ?? '(component)');
  }
  return String(v);
}
const arr = (v: { x: number; y: number; z: number }) => [round(v.x), round(v.y), round(v.z)];

/**
 * Current property values at `id`, as plain JSON — what `get_telemetry` returns.
 *
 * Nodes and components share one scene-wide id namespace (a `#ref` resolves against
 * either), so this resolves either kind: a **node** id reports the node's transform
 * plus every component on it; a **component** id reports that component alone, plus
 * the transform of the node hosting it — a component's state is rarely meaningful
 * without knowing where it is.
 *
 * Only `@property` fields are reported: they are the component's declared surface,
 * the same set the inspector and the XML expose. A plain runtime field is private
 * working memory and deliberately absent.
 *
 * Exported as a free function (like `resolveInEngine`) so it can be tested against a
 * headless Engine without constructing a renderer-backed session.
 */
export function telemetryFor(engine: Engine, id: string): unknown {
  const node = engine.findObject(id);
  if (node) {
    const components: Record<string, Record<string, unknown>> = {};
    for (const c of engine.getComponents(node)) {
      // Surface the component's scene id (if any), alongside its @property values.
      components[componentName(c) ?? c.constructor.name] = { ...(c.id !== undefined ? { id: c.id } : {}), ...propValues(c) };
    }
    return { id, type: node.type, transform: transformOf(node), components };
  }

  // Not a node — try the component id index, which engine.findComponent resolves
  // directly. Its own node fallback cannot fire here, since findObject already missed.
  const component = engine.findComponent(id);
  if (component) {
    const host = component.node;
    return {
      id,
      kind: 'component',
      type: componentName(component) ?? component.constructor.name,
      node: { ...(host.sceneId !== undefined ? { id: host.sceneId } : {}), type: host.type },
      transform: transformOf(host),
      properties: propValues(component),
    };
  }

  return { error: `no node or component with id "${id}"` };
}

/** A node's authored-shaped transform for telemetry (eulers in degrees, like the XML). */
function transformOf(node: Object3D): Record<string, unknown> {
  return {
    position: arr(node.position),
    eulerAngles: node.eulerAngles.toArray(),
    scale: arr(node.scale),
    visible: node.visible,
  };
}

function vec3(s?: string): Vector3 | undefined {
  if (!s) return undefined;
  const p = s.split(/[ ,]+/).map(Number).filter((n) => Number.isFinite(n));
  return p.length === 3 ? new Vector3(p[0], p[1], p[2]) : undefined;
}
function count(root: Object3D): number {
  let n = 0;
  root.traverse(() => n++);
  return n;
}
