import {
  AmbientLight, Box3, Color, DirectionalLight, PerspectiveCamera, Sphere, Vector3, type Object3D,
} from 'three';
import { Engine, Registry, bundleKind, type Bundle, type Component } from '@scenoco-three/core';
import type { EditOp } from '../src/protocol.js';

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

  private bundle?: Bundle;
  /** Source path of the open scene/prefab — the target of `save`. */
  filePath?: string;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.engine = this.makeEngine(true);
  }

  private makeEngine(editor: boolean): Engine {
    return new Engine({ canvas: this.canvas, autoStart: false, editor, preserveDrawingBuffer: true });
  }

  /** Fetch + load a scene/prefab (edit mode). Returns a small summary. */
  async open(path: string): Promise<{ file: string; kind: 'scene' | 'prefab'; nodes: number }> {
    const res = await fetch(`/@scenoco/bundle?file=${encodeURIComponent(path)}`);
    const data = (await res.json()) as Bundle | { error: string };
    if (!res.ok || !Array.isArray(data)) throw new Error((data as { error?: string }).error ?? 'failed to open file');
    this.bundle = data;
    this.filePath = path;
    this.toEdit();
    return { file: path, kind: bundleKind(this.bundle) === 'prefab' ? 'prefab' : 'scene', nodes: count(this.engine.scene) };
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
      components[componentName(c) ?? c.constructor.name] = propValues(c);
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
      this.engine.scene.add(new AmbientLight(0xffffff, 0.6));
      const key = new DirectionalLight(0xffffff, 2);
      key.position.set(3, 5, 4);
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
    const center = new Vector3();
    let radius = 1;
    if (!box.isEmpty()) {
      const sphere = box.getBoundingSphere(new Sphere());
      center.copy(sphere.center);
      radius = sphere.radius || 1;
    }
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
