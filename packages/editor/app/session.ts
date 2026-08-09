import {
  AmbientLight, Box3, Color, DirectionalLight, PerspectiveCamera, Sphere, Vector3, type Camera, type Object3D,
} from 'three';
import {
  Engine,
  KEY_CODES,
  MouseButton,
  PrefabAsset,
  Registry,
  VEC3_FORMAT,
  bundleKind,
  keyCodeFromName,
  parseVecText,
  type Bundle,
  type CameraFitConfig,
  type Component,
  type KeyCode,
} from '@scenoco-three/core';
import type { SceneProvenance } from '@scenoco-three/compiler';
import type { EditOp, EditorResult, NodeRef, PreviewFrame, SimStep, StructuralOp } from '../src/protocol.js';
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
  private runTick(dt: number, engine: Engine = this.engine): string | undefined {
    try {
      engine.tick(dt);
      return undefined;
    } catch (e) {
      this.playing = false;
      const message = e instanceof Error ? (e.stack ?? e.message) : String(e);
      this.onRuntimeError?.(message);
      return message;
    }
  }

  /**
   * Capture the current view as a PNG data URL from an explicit framing:
   * `camera` is a position in the scene DSL's vector grammar ("y: 6; z: 12"), or
   * "fit" to auto-frame the whole scene. `frame` states the output format — see
   * {@link PreviewFrame}.
   */
  async preview(opts: { camera: string; lookAt?: string; frame: PreviewFrame }): Promise<string> {
    await this.settleForCapture();

    // Particles only emit under their play-mode render system — render a short
    // throwaway play burst so a VFX prefab isn't previewed empty while authoring.
    if (this.mode === 'edit' && this.hasParticles()) return this.particlePreview(opts);

    const restore = this.frameShot(opts);
    try {
      // Guarded — a bad frame won't wedge the session.
      return this.captureFrame(this.engine, opts.frame, () => void this.runTick(0));
    } finally {
      restore();
    }
  }

  /**
   * Hold a capture until whatever is still loading has arrived and the layout has
   * stopped moving.
   *
   * Everything else in a `simulate` batch is synchronous, which is the point — an
   * agent drives the game to an exact condition and samples it there. But a
   * synchronous batch can never let a *promise* settle, and uikit resolves its MSDF
   * font through a dynamic `import()`. So on a fresh page the first captures came
   * back with text unmeasured (flex children collapsed to zero width) and no way,
   * from a single shot, to tell that apart from a real layout bug. Stepping more
   * frames could not help: the frames were the thing that wasn't yielding.
   *
   * The wait is therefore *awaited real time*, not more frames, and it is a
   * precondition of capturing rather than a step an agent has to know to write —
   * a screenshot nobody asked to be flaky shouldn't need an incantation.
   *
   * Gameplay does not advance meanwhile: `playing` is held false, so the host RAF
   * loop ticks at `dt` 0 (see {@link tick}) and only layout catches up. Two
   * consecutive identical layout signatures end the wait; {@link SETTLE_TIMEOUT_MS}
   * bounds it, so a genuinely animating HUD costs one timeout and still captures.
   */
  private async settleForCapture(engine: Engine = this.engine): Promise<void> {
    const wasPlaying = this.playing;
    this.playing = false;
    try {
      const deadline = performance.now() + SETTLE_TIMEOUT_MS;
      let previous: string | undefined;
      let stable = 0;
      while (performance.now() < deadline) {
        this.runTick(0, engine);
        // A pending font is "not settled" no matter how still the boxes look: an
        // unmeasured Text is stable at zero size, which is exactly the false
        // steady state this gate exists to see through.
        const signature = pendingFonts(engine) > 0 ? undefined : uiSignature(engine);
        if (signature !== undefined && signature === previous && ++stable >= 2) return;
        if (signature !== previous) stable = 0;
        previous = signature;
        // A macrotask, not a microtask: an in-flight module/network response only
        // gets to run between tasks.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      this.playing = wasPlaying;
    }
  }

  /** Current property values at a scene id — see {@link telemetryFor}. */
  telemetry(id: string): unknown {
    return telemetryFor(this.engine, id);
  }

  /**
   * Execute a batch of player-simulation steps in order against the live engine —
   * transport, frame stepping, synthetic key/mouse/gamepad input, and preview/
   * telemetry captures. No real-time loop interleaves, so an agent can drive the
   * game to a precise condition and sample it there. Injected input is committed
   * on the next `step`, so the usual order is input → step → preview/telemetry.
   * Returns the captures in step order.
   *
   * The one await is inside each `preview` — {@link settleForCapture}, which lets
   * pending loads land before a shot is taken. Gameplay is held still across it,
   * so what a step advances is still only what the batch asked for.
   *
   * `frame` is the batch's capture format, applied to every `preview` step — see
   * {@link PreviewFrame} for why it is stated once here rather than per step.
   */
  async simulate(steps: SimStep[], frame: PreviewFrame): Promise<EditorResult[]> {
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
        // Key names arrive as untyped strings over the wire, so they are resolved
        // against KeyCode here: a misspelling comes back as an error the agent can
        // read, instead of a keypress that silently never lands.
        case 'press': {
          const key = this.toKeyCode(step.key, out);
          if (!key) return out;
          input.injectKey(key, true);
          input.injectKey(key, false);
          break;
        }
        case 'keyDown': {
          const key = this.toKeyCode(step.key, out);
          if (!key) return out;
          input.injectKey(key, true);
          break;
        }
        case 'keyUp': {
          const key = this.toKeyCode(step.key, out);
          if (!key) return out;
          input.injectKey(key, false);
          break;
        }
        case 'click': {
          if (step.x !== undefined && step.y !== undefined) input.injectMouseMove(step.x, step.y);
          const b = step.button === 'right' ? MouseButton.Right : step.button === 'middle' ? MouseButton.Middle : MouseButton.Left;
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
          out.push({ kind: 'image', dataUrl: await this.preview({ camera: step.camera, ...(step.lookAt ? { lookAt: step.lookAt } : {}), frame }) });
          break;
        case 'telemetry':
          out.push({ kind: 'json', data: this.telemetry(step.id) });
          break;
      }
    }
    return out;
  }

  // ── capture ──────────────────────────────────────────────────────────────────

  /**
   * Render one frame of `engine` in `frame`'s format and return it as a PNG data
   * URL, then put everything back exactly as it was.
   *
   * Three things are staged for the shot and undone after it, because each of
   * them is a way a preview silently lies about the game:
   *  - **size** — the engine renders at `frame.width × frame.height` device
   *    pixels instead of whatever the editor window happens to be, so a capture
   *    is reproducible and doesn't change meaning when the user resizes a panel;
   *  - **fit** — every camera that will draw gets `frame.fit` for that aspect, so
   *    a portrait capture of a `fit="contain"` scene shows what portrait players
   *    see, not the editor's landscape framing stretched;
   *  - **UI** — hidden when `frame.ui` is false. Showing it needs no staging:
   *    {@link frameShot} already picked the camera that hosts it.
   *
   * `render` is the caller's own draw (a guarded tick), run once everything is
   * staged. Restoration is unconditional: a throwing frame must not leave the
   * live editor stuck at the capture's size.
   */
  private captureFrame(engine: Engine, frame: PreviewFrame, render: () => void): string {
    const restore: (() => void)[] = [];
    try {
      engine.renderSize = { width: frame.width, height: frame.height };
      restore.push(() => (engine.renderSize = undefined));
      for (const camera of engine.renderList()) restore.push(applyFit(camera, frame));
      if (!frame.ui) restore.push(hideScreenSpace(engine));
      // Settle frames before the real one, all at dt 0 so no gameplay time
      // passes. A capture size is not the size the last frame was drawn at, and
      // the UI takes a few frames to catch up with that: the engine adopts a new
      // size at *render* time (after the systems have already run), so the first
      // frame is what tells the layout its new viewport, and uikit then needs
      // another before its meshes match what it computed. Capturing any earlier
      // yields a HUD at the previous frame's scale — or, from a cold size, an
      // invisible one. Cheap insurance: an unchanged size makes these no-ops.
      for (let i = 0; i < UI_SETTLE_FRAMES; i++) this.runTick(0, engine);
      render();
      return this.canvas.toDataURL('image/png');
    } finally {
      // Undo in reverse, then render once more at the canvas's own size so the
      // editor viewport is left showing the scene, not the last capture.
      for (const undo of restore.reverse()) undo();
      this.runTick(0);
    }
  }

  /**
   * Point a camera at what this shot should show, make it the render camera, and
   * return the undo for anything that must not outlive the capture.
   *
   * **Which** camera is the whole trick. A `<Fullscreen>` HUD is a child of a
   * camera node (the engine's rule) and lays itself out against *that* camera, so
   * a shot framed through any other one shows the HUD sitting in world space in
   * front of a camera nobody is looking through — off to the side, or missing.
   * With the UI in the shot we therefore borrow the HUD's own camera and pose
   * that, which makes the layout right by construction and is the honest answer
   * anyway: the player's HUD is the one on the player's camera.
   *
   * (Re-parenting the HUD onto a preview camera instead does not work — uikit
   * rebuilds its own hierarchy on add, and the *second* capture comes back
   * without a HUD.)
   *
   * Without UI — or with no camera hosting any — nothing is borrowed and the
   * editor/preview camera frames the shot exactly as before.
   */
  private frameShot(opts: { camera: string; lookAt?: string; frame: PreviewFrame }): () => void {
    const engine = this.engine;
    const host = opts.frame.ui ? screenSpaceHost(engine) : undefined;
    if (!host) {
      if (this.mode === 'edit') {
        if (this.editorCamera) poseCamera(this.editorCamera, opts, engine.scene);
      } else {
        // Play mode: honor the camera override (P2) and give a camera-less lone
        // prefab a default framed camera + backdrop, so it isn't a blank frame.
        this.framePlayPreview(opts);
      }
      return () => {};
    }

    const previousMain = engine.mainCamera;
    const position = host.position.clone();
    const quaternion = host.quaternion.clone();
    poseCamera(host, opts, engine.scene);
    engine.mainCamera = host;
    return () => {
      host.position.copy(position);
      host.quaternion.copy(quaternion);
      engine.mainCamera = previousMain;
    };
  }

  // ── internals ────────────────────────────────────────────────────────────────

  /**
   * Resolve a wire key name to a `KeyCode`, or push an error result and return
   * undefined — the caller then abandons the batch. Listing the valid names in
   * the error is what makes it actionable: the caller is usually an agent that
   * guessed a spelling ('SPACE', 'ArrowUp') rather than a person reading docs.
   */
  private toKeyCode(name: string, out: EditorResult[]): KeyCode | undefined {
    const key = keyCodeFromName(name);
    if (key) return key;
    out.push({ kind: 'json', data: { error: `Unknown key "${name}". Valid KeyCode names: ${KEY_CODES.join(', ')}` } });
    return undefined;
  }

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
  private framePlayPreview(opts: { camera: string; lookAt?: string }): void {
    const fit = opts.camera === 'fit';
    const camPos = fit ? undefined : capturePoint(opts.camera);
    const lookAt = fit ? undefined : capturePoint(opts.lookAt);
    if (this.engine.mainCamera && !fit && !camPos && !lookAt) return; // scene's own camera, no explicit framing — leave it
    const cam = (this.previewCamera ??= new PerspectiveCamera(50, 1, 0.01, 50000));
    poseCamera(cam, opts, this.engine.scene);
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
  private particlePreview(opts: { camera: string; lookAt?: string; frame: PreviewFrame }): string {
    const engine = new Engine({ canvas: this.canvas, autoStart: false, editor: false, preserveDrawingBuffer: true });
    try {
      if (this.bundle) applyBundleToEngine(engine, this.bundle);
      this.applyEditOverlay(engine); // preview unsaved edits too
      const cam = new PerspectiveCamera(50, opts.frame.width / opts.frame.height, 0.01, 50000);
      poseCamera(cam, opts, engine.scene);
      cam.updateProjectionMatrix();
      engine.mainCamera = cam;
      return this.captureFrame(engine, opts.frame, () => {
        for (let i = 0; i < PARTICLE_PREVIEW_FRAMES; i++) engine.tick(1 / 60);
      });
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

/** Frames a capture settles for before it is taken — see the call site in `captureFrame`. */
const UI_SETTLE_FRAMES = 3;

/** Upper bound on the wall-clock wait in `settleForCapture` — a HUD that never stops moving still gets captured. */
const SETTLE_TIMEOUT_MS = 2000;

/**
 * uikit's `Text` publishes its resolved MSDF font as `fontSignal`, `undefined`
 * until the font's dynamic `import()` lands. Duck-typed on purpose: the editor
 * has no dependency on `@scenoco-three/ui` (tag packages are the project's
 * choice, not the editor's), and this is the one bit of their state a capture
 * has to wait on.
 */
export function pendingFonts(engine: Engine): number {
  let pending = 0;
  engine.scene.traverse((o) => {
    const signal = (o as { fontSignal?: { value?: unknown } }).fontSignal;
    if (signal && typeof signal === 'object' && signal.value == null) pending++;
  });
  return pending;
}

/**
 * A fingerprint of where the UI currently *is*: each uikit root's world bounds
 * plus its descendant count. The count matters as much as the bounds — glyph
 * meshes are added to the tree as text is measured, so a reflow that leaves the
 * outer box the same size still shows up here.
 */
function uiSignature(engine: Engine): string {
  const box = new Box3();
  const parts: string[] = [];
  for (const { object } of screenSpaceRoots(engine)) {
    let count = 0;
    object.traverse(() => count++);
    box.setFromObject(object);
    const extent = box.isEmpty() ? 'empty' : [...box.min.toArray(), ...box.max.toArray()].map((n) => n.toFixed(4)).join(',');
    parts.push(`${count}@${extent}`);
  }
  return parts.join(';');
}

/**
 * Give `camera` the capture's fit mode for the duration of one shot, and return
 * the undo.
 *
 * The engine already re-fits every render camera to the current aspect each
 * tick — all this does is swap in the requested mode first, so the shot answers
 * "how would this camera frame the scene at this size under *this* rule". The
 * camera's authored design region is what it fits against; a camera that has
 * none (an editor or preview camera) gets the capture's own size, which makes
 * the design aspect equal the capture aspect and every mode a no-op — correct,
 * since there is nothing to adapt to. `_fitAspect` is cleared on both the way in
 * and the way out, or the engine would skip re-fitting an aspect it thinks it
 * already applied.
 */
function applyFit(camera: Camera, frame: PreviewFrame): () => void {
  const data = camera.userData as { fit?: CameraFitConfig; baseFov?: number; _fitAspect?: number };
  const previous = { fit: data.fit, baseFov: data.baseFov, fov: (camera as PerspectiveCamera).fov };
  data.fit = {
    mode: frame.fit,
    designWidth: previous.fit?.designWidth ?? frame.width,
    designHeight: previous.fit?.designHeight ?? frame.height,
  };
  data._fitAspect = undefined;
  return () => {
    data.fit = previous.fit;
    data.baseFov = previous.baseFov;
    data._fitAspect = undefined;
    const perspective = camera as PerspectiveCamera;
    if (perspective.isPerspectiveCamera) {
      perspective.fov = previous.fov;
      perspective.updateProjectionMatrix();
    }
  };
}

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

/**
 * Position `cam` to frame `scene` from a 3/4 angle; returns the scene center it
 * looks at. Takes any camera — a shot with UI is framed through the scene's own,
 * which may be orthographic (its frustum is fixed, so only the pose moves).
 */
function frameCameraTo(cam: Camera, scene: Object3D): Vector3 {
  const box = contentBounds(scene);
  const sphere = box.isEmpty() ? new Sphere(new Vector3(), 1) : box.getBoundingSphere(new Sphere());
  const center = sphere.center;
  const radius = sphere.radius || 1;
  // Back off along the fixed 3/4 direction far enough that the bounding sphere
  // fits the camera's *own* vertical fov — a borrowed scene camera is rarely the
  // 50° the editor camera happens to use, and assuming it crops a narrow one.
  const halfFov = (((cam as PerspectiveCamera).fov || 50) * Math.PI) / 360;
  cam.position.copy(center).addScaledVector(new Vector3(0.6, 0.45, 1).normalize(), (radius / Math.sin(halfFov)) * 1.2);
  cam.lookAt(center);
  return center;
}

/**
 * World bounds of the scene's **content**, which is what "frame the whole scene"
 * means — camera subtrees and editor-only helpers excluded.
 *
 * Anything parented to a camera (a `<Fullscreen>` HUD, a camera-mounted
 * viewmodel) is screen furniture that follows the camera, not a place in the
 * world: including it makes the framing self-referential, and with a HUD it runs
 * away — each auto-frame moves the camera, which moves the HUD, which grows the
 * bounds, until the scene is a dot and then nothing at all. Selection outlines
 * and preview lights are excluded for the same reason they are hidden from the
 * Hierarchy: they are the editor, not the game.
 */
function contentBounds(root: Object3D): Box3 {
  const box = new Box3();
  root.updateMatrixWorld(true);
  const walk = (parent: Object3D): void => {
    for (const child of parent.children) {
      if (isEditorOnly(child) || isCamera(child)) continue;
      box.expandByObject(child);
      walk(child);
    }
  };
  walk(root);
  return box;
}

const isCamera = (o: Object3D): boolean => (o as Object3D & { isCamera?: boolean }).isCamera === true;

/**
 * The screen-space layer: everything parented to a camera. Defined structurally
 * rather than by asking a UI package, so a `<Fullscreen>` HUD, a camera-mounted
 * viewmodel and any future camera-relative content are all covered.
 */
function screenSpaceRoots(engine: Engine): { object: Object3D; host: Camera }[] {
  const roots: { object: Object3D; host: Camera }[] = [];
  engine.scene.traverse((o) => {
    if (!isCamera(o)) return;
    for (const child of o.children) if (!isEditorOnly(child)) roots.push({ object: child, host: o as Camera });
  });
  return roots;
}

/** The camera hosting the screen-space layer, if any — the one a shot with UI is framed through. */
function screenSpaceHost(engine: Engine): Camera | undefined {
  return screenSpaceRoots(engine)[0]?.host;
}

/** Take the screen-space layer out of the shot; returns the undo. */
function hideScreenSpace(engine: Engine): () => void {
  const hidden = screenSpaceRoots(engine).filter((r) => r.object.visible);
  for (const { object } of hidden) object.visible = false;
  return () => {
    for (const { object } of hidden) object.visible = true;
  };
}

/** Point `cam` at what the shot asks for: `"fit"` auto-frames the scene, else an explicit position (+ look-at). */
function poseCamera(cam: Camera, opts: { camera: string; lookAt?: string }, scene: Object3D): void {
  if (opts.camera === 'fit') {
    frameCameraTo(cam, scene);
    return;
  }
  const position = capturePoint(opts.camera);
  const lookAt = capturePoint(opts.lookAt);
  if (position) cam.position.copy(position);
  if (lookAt) cam.lookAt(lookAt);
  else if (position) cam.lookAt(contentBounds(scene).getCenter(new Vector3()));
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
  if (o.isVector3) return axes(o.x!, o.y!, o.z!);
  if (o.isVector2) return { x: o.x, y: o.y };
  if (o.isEuler) return axes(toDeg(o.x!), toDeg(o.y!), toDeg(o.z!));
  if (o.isColor) return `#${o.getHexString!()}`;
  // `#id`, the way a node reference is written in XML — and the way a *component*
  // reference already read back, two lines down. Bare, the two disagreed about
  // the same kind of thing.
  if (o.isObject3D) return o.sceneId ? `#${o.sceneId}` : '(node)';
  // A component reference → its scene #id (what the agent correlates on), falling
  // back to the class name only when the target has no id.
  if ('node' in (o as object) && 'engine' in (o as object)) {
    const c = v as Component;
    return c.id !== undefined ? `#${c.id}` : (componentName(c) ?? '(component)');
  }
  return String(v);
}
/**
 * A vector read back from the scene, **named by axis** — `{"x": 0, "y": 0.5, "z": 0}`.
 *
 * The DSL writes vectors as named axes (`position="y: 1.5"`) precisely so nobody
 * has to hold an index order in their head; a reading that comes back as
 * `[0, 0.5, 0]` hands that job straight back, and a caller correlating a
 * screenshot with a telemetry sample is doing spatial reasoning, which is exactly
 * when a mis-ordered axis is easiest to believe. An object rather than the DSL's
 * text form because this side is JSON: `t.transform.position.y` stays directly
 * comparable across two samples, which is what telemetry is *for*.
 */
const axes = (x: number, y: number, z: number) => ({ x, y, z });
const arr = (v: { x: number; y: number; z: number }) => axes(round(v.x), round(v.y), round(v.z));

/**
 * Current property values at `id`, as plain JSON — what `inspect` returns.
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
 * Every reading is stamped with `frame` and `time` (the engine's `frameCount` and
 * scaled `time`). A `simulate` batch returns its captures as a flat ordered list, so
 * without the stamp two samples of the same id are indistinguishable — the stamp is
 * what ties a reading to the point in the run that produced it, and what makes
 * "it moved 1.2 units over 30 frames" a statement the numbers support. It is
 * present on a miss too: *when* an id stopped resolving is itself an assertion
 * about a thing that was destroyed.
 *
 * Exported as a free function (like `resolveInEngine`) so it can be tested against a
 * headless Engine without constructing a renderer-backed session.
 */
export function telemetryFor(engine: Engine, id: string): unknown {
  // Frames ticked and simulated seconds elapsed — the "when" of this reading.
  const when = { frame: engine.frameCount, time: round(engine.time) };
  const node = engine.findObject(id);
  if (node) {
    const components: Record<string, Record<string, unknown>> = {};
    for (const c of engine.getComponents(node)) {
      // Surface the component's scene id (if any), alongside its @property values.
      components[componentName(c) ?? c.constructor.name] = { ...(c.id !== undefined ? { id: c.id } : {}), ...propValues(c) };
    }
    return { ...when, id, type: node.type, transform: transformOf(node), components };
  }

  // Not a node — try the component id index, which engine.findComponent resolves
  // directly. Its own node fallback cannot fire here, since findObject already missed.
  const component = engine.findComponent(id);
  if (component) {
    const host = component.node;
    return {
      ...when,
      id,
      kind: 'component',
      type: componentName(component) ?? component.constructor.name,
      node: { ...(host.sceneId !== undefined ? { id: host.sceneId } : {}), type: host.type },
      transform: transformOf(host),
      properties: propValues(component),
    };
  }

  return { ...when, error: `no node or component with id "${id}"` };
}

/** A node's authored-shaped transform for telemetry (eulers in degrees, like the XML). */
function transformOf(node: Object3D): Record<string, unknown> {
  return {
    position: arr(node.position),
    eulerAngles: arr(node.eulerAngles),
    scale: arr(node.scale),
    visible: node.visible,
  };
}

/**
 * A point given to a capture (`camera`, `lookAt`), read with **the scene DSL's own
 * vector grammar** — `parseVecText`, the same function the compiler and the
 * inspector use. So `"y: 6; z: 12"` means here exactly what it means in the XML the
 * agent just wrote, and the positional `"0 6 12"` keeps working as it always has.
 *
 * Two grammars for one concept was the whole problem: the keyed form used to parse
 * as garbage, get filtered out, and return `undefined` — which {@link poseCamera}
 * reads as "no position given", so the shot came back framed from wherever the
 * camera happened to be, with nothing said. A malformed vector now throws and the
 * message teaches the grammar, the way an unknown `KeyCode` already does.
 */
export function capturePoint(s?: string): Vector3 | undefined {
  if (!s) return undefined;
  const parsed = parseVecText(s, VEC3_FORMAT);
  if (!parsed.ok) throw new Error(parsed.message);
  return new Vector3(parsed.value[0], parsed.value[1], parsed.value[2]);
}
function count(root: Object3D): number {
  let n = 0;
  root.traverse(() => n++);
  return n;
}
