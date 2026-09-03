import { Quaternion, Vector3, type Camera, type Object3D, type Scene } from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

export type GizmoMode = 'translate' | 'rotate' | 'scale';

/** Which axes the handles follow: the world's, or the object's own. */
export type GizmoSpace = 'world' | 'local';

/**
 * How far the pointer must travel before a press on a handle counts as a drag.
 *
 * No click is perfectly still — a real mouse moves a pixel or two between down and up — and
 * `TransformControls` applies every one of those pixels. Without a threshold, clicking an object
 * in scale mode quietly resizes it by a fraction of a percent, which is invisible on screen and
 * permanent in the document: the file gains a `scale` attribute nobody asked for.
 */
const DRAG_THRESHOLD = 3;

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

  private readonly scene: Scene;

  /** Where the press started, while one is in progress. */
  private pressedAt: { x: number; y: number } | null = null;
  /** True once a press has travelled far enough to be a drag. */
  private travelled = false;
  /** The attached object's transform at the moment of the press, to put back after a click. */
  private readonly grabbed = {
    position: new Vector3(),
    quaternion: new Quaternion(),
    scale: new Vector3(),
    /** Kept alongside the quaternion because it is the form the document writes. */
    eulerAngles: new Vector3(),
  };

  constructor(
    camera: Camera,
    domElement: HTMLElement,
    scene: Scene,
    touch: boolean,
    opts: GizmoOptions = {},
  ) {
    this.scene = scene;
    this.controls = new TransformControls(camera, domElement);
    this.controls.setSize(touch ? 1.4 : 1); // fat-finger handles on touch
    this.helper = this.controls.getHelper();
    this.helper.userData.scenocoToolOnly = true; // keep it out of the Hierarchy + picking
    scene.add(this.helper);

    domElement.addEventListener('pointerdown', (event) => {
      this.pressedAt = { x: event.clientX, y: event.clientY };
      this.travelled = false;
    });
    domElement.addEventListener('pointermove', (event) => {
      if (!this.pressedAt || this.travelled) return;
      this.travelled = Math.hypot(event.clientX - this.pressedAt.x, event.clientY - this.pressedAt.y) > DRAG_THRESHOLD;
    });

    // A press that never travelled changed nothing the user meant to change, so the object goes
    // back to where it was grabbed and the document never hears about it.
    this.controls.addEventListener('objectChange', () => {
      if (this.travelled) opts.onObjectChange?.();
    });
    this.controls.addEventListener('dragging-changed', (e) => {
      // Fired true at drag start, false at drag end.
      const object = this.controls.object;
      if (!object) return;
      if (e.value) {
        this.grabbed.position.copy(object.position);
        this.grabbed.quaternion.copy(object.quaternion);
        this.grabbed.scale.copy(object.scale);
        this.grabbed.eulerAngles.copy(object.eulerAngles);
        return;
      }
      this.pressedAt = null;
      if (this.travelled) opts.onCommit?.(object);
      else {
        object.position.copy(this.grabbed.position);
        object.quaternion.copy(this.grabbed.quaternion);
        object.scale.copy(this.grabbed.scale);
      }
    });
  }

  /**
   * The attached object's value for one channel as it was when the drag began.
   *
   * Undo needs this and cannot work it out later. By the time the first edit is recorded the
   * object has already moved — the write happens *because* it moved — so a "before" captured
   * there is a frame late. For a channel the document writes, undo restores the text and the
   * error never shows; for one it does not write (a rotation left at zero, a scale left at one,
   * which is most of them) there is nothing to restore from, and the object is left wherever
   * that first frame put it.
   */
  grabbedValue(channel: 'position' | 'eulerAngles' | 'scale'): Vector3 {
    return this.grabbed[channel];
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

  /**
   * Whether the handles line up with the world's axes or the object's own — Unity's
   * Global/Local button.
   *
   * It changes what a drag means, not just how it looks: dragging the green arrow moves a node
   * along world Y in one space and along its own up in the other, and for anything rotated the
   * two are different edits.
   */
  setSpace(space: GizmoSpace): void {
    this.controls.setSpace(space);
  }
  get space(): GizmoSpace {
    return this.controls.space as GizmoSpace;
  }

  /**
   * Point the handles at an object — never at the handles themselves.
   *
   * Attaching the control to its own helper makes the helper its own parent's target: three walks
   * `updateMatrixWorld` between the two for ever and the page dies on a stack overflow. It is one
   * mis-routed pick away, and there is no legitimate reason to aim a gizmo at a gizmo, so it is
   * refused here rather than trusted to every caller.
   */
  attach(object: Object3D | null): void {
    if (object && !this.contains(object)) this.controls.attach(object);
    else this.controls.detach();
  }

  /** True if `object` is part of the gizmo's own helper. */
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
