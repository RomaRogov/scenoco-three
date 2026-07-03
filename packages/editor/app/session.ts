import {
  AmbientLight, Box3, Color, DirectionalLight, PerspectiveCamera, Sphere, Vector3, type Object3D,
} from 'three';
import { Engine, Registry, bundleKind, type Bundle, type Component } from '@scenoco-three/core';
import type { SceneProvenance } from '@scenoco-three/compiler';
import type { EditOp, EditorResult, SimStep } from '../src/protocol.js';

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
  /** Fired after the engine/scene changes, so the host rebinds camera + panels. */
  onChange?: () => void;
  /** Fired when a watched file changes on disk (the open file or a `src=` dep). */
  onExternalChange?: (file: string, role: 'open' | 'dep') => void;

  private bundle?: Bundle;
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

  /** Fetch + load a scene/prefab (edit mode). Returns a small summary. */
  async open(path: string): Promise<{ file: string; kind: 'scene' | 'prefab'; nodes: number; componentError?: string }> {
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

  /** Write a set of attribute edits back to the source file (surgical diff). */
  async save(edits: EditOp[]): Promise<{ changed: number; unresolved: number }> {
    if (!this.filePath) throw new Error('no file open to save');
    const res = await fetch('/@scenoco/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: this.filePath, edits }),
    });
    const data = (await res.json()) as { changed: number; unresolved: number; error?: string };
    if (!res.ok) throw new Error(data.error ?? 'save failed');
    return data;
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
    this.engine.tick(dt); // bypass the play+paused gate in tick()
  }
  stop(): void {
    this.toEdit();
  }

  /** Advance one frame: edit always renders; play advances only while playing. */
  tick(dt: number): void {
    this.engine.tick(this.mode === 'play' && !this.playing ? 0 : dt);
  }

  /** Capture the current view as a PNG data URL (optionally re-framing the editor camera). */
  preview(opts: { camera?: string; lookAt?: string }): string {
    if (this.mode === 'edit' && this.editorCamera) {
      const cam = vec3(opts.camera);
      const look = vec3(opts.lookAt);
      if (cam) this.editorCamera.position.copy(cam);
      if (look) this.editorCamera.lookAt(look);
    }
    this.engine.tick(0); // render the current frame
    return this.canvas.toDataURL('image/png');
  }

  /** Current property values for the node + its components at `id`, as plain JSON. */
  telemetry(id: string): unknown {
    const node = this.engine.findObject(id);
    if (!node) return { error: `no object with id "${id}"` };
    const components: Record<string, Record<string, unknown>> = {};
    for (const c of this.engine.getComponents(node)) {
      // Surface the component's scene id (if any), alongside its @property values.
      components[componentName(c) ?? c.constructor.name] = { ...(c.id !== undefined ? { id: c.id } : {}), ...propValues(c) };
    }
    return {
      id,
      type: node.type,
      transform: {
        position: arr(node.position),
        rotation: degArr(node.rotation),
        scale: arr(node.scale),
        visible: node.visible,
      },
      components,
    };
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
          for (let i = 0; i < frames; i++) this.engine.tick(dt);
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
    if (bundleKind(this.bundle) === 'prefab') {
      this.engine.instantiate(this.bundle);
      // Editor-only preview lights — flagged so the Hierarchy/picking ignore them.
      const ambient = new AmbientLight(0xffffff, 0.6);
      ambient.userData.scenocoEditorOnly = true;
      this.engine.scene.add(ambient);
      const key = new DirectionalLight(0xffffff, 2);
      key.position.set(3, 5, 4);
      key.userData.scenocoEditorOnly = true;
      this.engine.scene.add(key);
      if (!this.engine.scene.background) this.engine.scene.background = new Color(0x15181f);
    } else {
      this.engine.loadScene(this.bundle);
    }
  }

  /** Editor camera framing the scene from a 3/4 angle. */
  private frameCamera(): PerspectiveCamera {
    const cam = new PerspectiveCamera(50, this.canvas.clientWidth / this.canvas.clientHeight || 1, 0.01, 50000);
    const box = new Box3().setFromObject(this.engine.scene);
    const sphere = box.isEmpty() ? new Sphere(new Vector3(), 1) : box.getBoundingSphere(new Sphere());
    const center = sphere.center;
    const radius = sphere.radius || 1;
    cam.position.copy(center).addScaledVector(new Vector3(0.6, 0.45, 1).normalize(), (radius / Math.sin((50 * Math.PI) / 180 / 2)) * 1.2);
    cam.lookAt(center);
    this.engine.mainCamera = cam;
    return cam;
  }
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
  const o = v as { isVector3?: boolean; isVector2?: boolean; isColor?: boolean; isEuler?: boolean; isObject3D?: boolean; x?: number; y?: number; z?: number; name?: string; getHexString?: () => string };
  if (o.isVector3) return [o.x, o.y, o.z];
  if (o.isVector2) return [o.x, o.y];
  if (o.isEuler) return [deg(o.x!), deg(o.y!), deg(o.z!)];
  if (o.isColor) return `#${o.getHexString!()}`;
  if (o.isObject3D) return o.name || '(node)';
  if ('node' in (o as object) && 'engine' in (o as object)) return componentName(v as Component) ?? '(component)';
  return String(v);
}
const arr = (v: { x: number; y: number; z: number }) => [round(v.x), round(v.y), round(v.z)];
const degArr = (v: { x: number; y: number; z: number }) => [deg(v.x), deg(v.y), deg(v.z)];
const deg = (rad: number) => round((rad * 180) / Math.PI);
const round = (n: number) => Math.round(n * 1000) / 1000;

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
function registeredMeta(component: Component) {
  for (const name of Registry.componentNames()) {
    const entry = Registry.getComponent(name);
    if (entry && component instanceof entry.ctor) return entry.meta;
  }
  return undefined;
}
function componentName(component: Component): string | undefined {
  for (const name of Registry.componentNames()) {
    const entry = Registry.getComponent(name);
    if (entry && component.constructor === entry.ctor) return name;
  }
  return undefined;
}
