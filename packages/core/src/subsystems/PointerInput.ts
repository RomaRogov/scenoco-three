import type { Camera, Intersection, Object3D, Vector2, Vector3 } from 'three';
import type { Component } from '../runtime/Component.js';
import { MOUSE_BUTTONS, type InputManager, type MouseButton } from './Input.js';

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
  /** Which button drove this event — left, right or middle. */
  button: MouseButton;
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
  /**
   * Per button, the object its press landed on — so the release/click/drag can
   * target it. Tracked per button (not one shared slot) because the buttons are
   * independent: a right-press while dragging with the left must not steal or
   * clear the left button's target.
   */
  private readonly pressed = new Map<MouseButton, Object3D>();

  constructor(private readonly host: PointerHost) {}

  /**
   * Raycast from the pointer on press/release and deliver `onPointerDown` /
   * `onPointerUp` / `onPointerClick` to the hit object's components, bubbling up
   * its ancestors — for every mouse button, with `event.button` naming which one.
   * `onPointerUp` goes to the originally-pressed object; `onPointerClick` fires
   * only when the release is over that same object. No-op without a camera.
   * Cheap: raycasts at most once per frame, and only on a press/release edge.
   */
  dispatch(): void {
    const { input, mainCamera } = this.host;
    if (!mainCamera) return;
    // Forget a pressed object that has left the scene (destroyed mid-press, or a
    // scene swap detached it) — otherwise it would be retained until the next
    // press and could still receive onDrag/onPointerUp after teardown.
    for (const [button, object] of this.pressed) if (!this.inScene(object)) this.pressed.delete(button);

    // One raycast shared by every button that has an edge this frame — the ray is
    // the same for all of them, and a frame with no edge casts nothing at all.
    let hit: Intersection | undefined;
    let cast = false;
    const hitNow = (): Intersection | undefined => {
      if (cast) return hit;
      cast = true;
      return (hit = this.host.raycast()[0]);
    };

    for (const button of MOUSE_BUTTONS) {
      const down = input.getMouseButtonDown(button);
      const up = input.getMouseButtonUp(button);
      const pressed = this.pressed.get(button);

      // Drag: pointer held + moving after a press, delivered to the pressed object.
      // Delta-based — no raycast (the dragged object needn't stay under the cursor).
      if (!down && pressed && input.getMouseButton(button)) {
        const delta = input.mouseDelta;
        if (delta.x !== 0 || delta.y !== 0) this.emit('onDrag', pressed, button, undefined, delta);
      }

      if (!down && !up) continue;
      if (down) {
        const landed = hitNow();
        if (landed) {
          this.pressed.set(button, landed.object);
          this.emit('onPointerDown', landed.object, button, landed);
        } else {
          this.pressed.delete(button);
        }
      }
      if (up) {
        const target = this.pressed.get(button);
        this.pressed.delete(button);
        const released = hitNow();
        if (target) this.emit('onPointerUp', target, button, released);
        if (released && released.object === target) this.emit('onPointerClick', released.object, button, released);
      }
    }
  }

  /** Whether an object is still attached under the host scene root (destroyed nodes are detached at flush). */
  private inScene(object: Object3D): boolean {
    for (let o: Object3D | null = object; o; o = o.parent) if (o === this.host.scene) return true;
    return false;
  }

  /** Dispatch a pointer hook to a target's components, then bubble up to the scene root. */
  private emit(
    hook: PointerHook,
    target: Object3D,
    button: MouseButton,
    hit: Intersection | undefined,
    delta?: Vector2,
  ): void {
    const event: PointerEventData = { object: target, point: hit?.point, distance: hit?.distance, button };
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
