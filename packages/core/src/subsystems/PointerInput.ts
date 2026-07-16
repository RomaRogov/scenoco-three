import type { Camera, Intersection, Object3D, Vector2, Vector3 } from 'three';
import type { Component } from '../runtime/Component.js';
import type { InputManager } from './Input.js';

/**
 * Payload for the pointer hooks a component may implement — `onPointerDown` /
 * `onPointerUp` / `onPointerClick` / `onDrag` (Unity-style). Dispatched by
 * raycasting from the pointer through `mainCamera`, then bubbling up the hit
 * object's ancestors.
 */
export interface PointerEventData {
  /** The hit object (for down/click) or the originally-pressed object (for up/drag). */
  object: Object3D;
  /** World-space point of the hit, when there is one (absent for drag). */
  point?: Vector3;
  /** Distance from the camera to the hit. */
  distance?: number;
  /** Mouse button (0 = left). */
  button: number;
  /** Pointer movement this frame, in pixels — set for `onDrag`. */
  delta?: Vector2;
}

/** The pointer hook names a component may implement (duck-typed). */
type PointerHook = 'onPointerDown' | 'onPointerUp' | 'onPointerClick' | 'onDrag';

/**
 * What the pointer dispatcher needs from the engine each frame — kept as a narrow
 * interface (satisfied structurally by `Engine`) so this module never imports the
 * engine, only reads the few things it needs.
 */
export interface PointerHost {
  readonly input: InputManager;
  readonly mainCamera?: Camera;
  readonly scene: Object3D;
  raycast(): Intersection[];
  getComponents(node: Object3D): readonly Component[];
}

/**
 * Turns raw pointer input into Unity/DOM-style pointer events on components. The
 * engine ticks it once per frame in play mode; it raycasts only on a press/
 * release edge (cheap) and remembers the pressed object so release/click/drag can
 * target it even after the cursor leaves.
 */
export class PointerInput {
  /** The object a pointer press landed on, so the release/click/drag can target it. */
  private pressed?: Object3D;

  constructor(private readonly host: PointerHost) {}

  /**
   * Raycast from the pointer on press/release and deliver `onPointerDown` /
   * `onPointerUp` / `onPointerClick` to the hit object's components, bubbling up
   * its ancestors. `onPointerUp` goes to the originally-pressed object;
   * `onPointerClick` fires only when the release is over that same object. No-op
   * without a camera. Cheap: only raycasts on a click edge.
   */
  dispatch(): void {
    const { input, mainCamera } = this.host;
    if (!mainCamera) return;
    // Forget a pressed object that has left the scene (destroyed mid-press, or a
    // scene swap detached it) — otherwise it would be retained until the next
    // press and could still receive onDrag/onPointerUp after teardown.
    if (this.pressed && !this.inScene(this.pressed)) this.pressed = undefined;
    const down = input.getMouseButtonDown(0);
    const up = input.getMouseButtonUp(0);

    // Drag: pointer held + moving after a press, delivered to the pressed object.
    // Delta-based — no raycast (the dragged object needn't stay under the cursor).
    if (!down && this.pressed && input.getMouseButton(0)) {
      const delta = input.mouseDelta;
      if (delta.x !== 0 || delta.y !== 0) this.emit('onDrag', this.pressed, undefined, delta);
    }

    if (!down && !up) return;
    const hit = this.host.raycast()[0];
    if (down) {
      this.pressed = hit?.object;
      if (hit) this.emit('onPointerDown', hit.object, hit);
    }
    if (up) {
      const pressed = this.pressed;
      this.pressed = undefined;
      if (pressed) this.emit('onPointerUp', pressed, hit);
      if (hit && hit.object === pressed) this.emit('onPointerClick', hit.object, hit);
    }
  }

  /** Whether an object is still attached under the host scene root (destroyed nodes are detached at flush). */
  private inScene(object: Object3D): boolean {
    for (let o: Object3D | null = object; o; o = o.parent) if (o === this.host.scene) return true;
    return false;
  }

  /** Dispatch a pointer hook to a target's components, then bubble up to the scene root. */
  private emit(hook: PointerHook, target: Object3D, hit: Intersection | undefined, delta?: Vector2): void {
    const event: PointerEventData = { object: target, point: hit?.point, distance: hit?.distance, button: 0 };
    if (delta) event.delta = delta.clone();
    for (let object: Object3D | null = target; object; object = object.parent) {
      for (const component of this.host.getComponents(object)) {
        if (component._destroyed) continue;
        const fn = (component as unknown as Record<string, unknown>)[hook];
        if (typeof fn === 'function') (fn as (e: PointerEventData) => void).call(component, event);
      }
      if (object === this.host.scene) break;
    }
  }
}
