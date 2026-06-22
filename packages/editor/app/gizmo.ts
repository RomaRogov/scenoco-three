import type { Camera, Object3D, Scene } from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

export type GizmoMode = 'translate' | 'rotate' | 'scale';

export interface GizmoOptions {
  /** Live refresh while dragging (e.g. update the inspector numbers). */
  onObjectChange?: () => void;
  /** Drag finished — commit the object's new transform as one undoable edit. */
  onCommit?: (object: Object3D) => void;
}

/**
 * Thin wrapper over three's `TransformControls` (translate/rotate/scale handles).
 * The control mutates the attached `Object3D` directly during a drag; on drag end
 * we hand the object to `onCommit`, which records a single undoable edit (the
 * compiled scene was untouched during the drag, so it still holds the pre-drag
 * value — exactly the right "before" for undo).
 *
 * Camera controls read `dragging` to stand down while a handle is being dragged,
 * so the fly camera and the gizmo never fight over the same pointer/touch.
 */
export class Gizmo {
  private readonly controls: TransformControls;
  private readonly helper: Object3D;

  constructor(
    camera: Camera,
    domElement: HTMLElement,
    private readonly scene: Scene,
    touch: boolean,
    opts: GizmoOptions = {},
  ) {
    this.controls = new TransformControls(camera, domElement);
    this.controls.setSize(touch ? 1.4 : 1); // fat-finger handles on touch
    this.helper = this.controls.getHelper();
    scene.add(this.helper);

    this.controls.addEventListener('objectChange', () => opts.onObjectChange?.());
    this.controls.addEventListener('dragging-changed', (e) => {
      // Fired true at drag start, false at drag end.
      if (!e.value && this.controls.object) opts.onCommit?.(this.controls.object);
    });
  }

  /** True while a handle is being dragged — camera controls check this to yield. */
  get dragging(): boolean {
    return this.controls.dragging;
  }

  setMode(mode: GizmoMode): void {
    this.controls.setMode(mode);
  }
  get mode(): GizmoMode {
    return this.controls.mode as GizmoMode;
  }

  attach(object: Object3D | null): void {
    if (object) this.controls.attach(object);
    else this.controls.detach();
  }

  /** True if `object` is part of the gizmo's own helper (so picks can ignore it). */
  contains(object: Object3D): boolean {
    for (let o: Object3D | null = object; o; o = o.parent) if (o === this.helper) return true;
    return false;
  }

  dispose(): void {
    this.controls.detach();
    this.scene.remove(this.helper);
    this.controls.dispose();
  }
}
