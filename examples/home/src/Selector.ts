import { Box3, Box3Helper, Raycaster, Vector2, type Object3D } from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { Behaviour, Input, MouseButton, findObjectsOfType } from '@scenoco-three/core';
import { Rigidbody } from '@scenoco-three/rapier';

/**
 * Pick a letter, as in the editor: a tap or click puts a wireframe box and a move gizmo on it.
 * While the gizmo is held the letter is kinematic — it follows the hand and shoves the others —
 * and when it is let go, it is a falling body again.
 */
export class Selector extends Behaviour {
  private readonly outline = new Box3Helper(new Box3(), '#e2f3ff');
  private gizmo: TransformControls | null = null;
  private picked: Object3D | null = null;
  private readonly pressedAt = new Vector2();
  private pressedOnGizmo = false;
  private readonly raycaster = new Raycaster();

  override start() {
    // The gizmo listens to the canvas itself, as three.js's TransformControls does everywhere.
    const gizmo = new TransformControls(this.camera, document.querySelector('canvas')!);
    gizmo.setSize(1.1);
    gizmo.addEventListener('dragging-changed', (event) => {
      const body = this.picked?.getComponent(Rigidbody);
      if (body) body.isKinematic = event.value as boolean;
    });
    this.node.add(gizmo.getHelper());
    this.gizmo = gizmo;
    this.outline.visible = false;
    this.node.add(this.outline);
  }

  override update() {
    if (Input.getMouseButtonDown(MouseButton.Left)) {
      this.pressedAt.copy(Input.mousePosition);
      this.pressedOnGizmo = this.gizmo?.axis != null;
    }
    // A tap, not the end of a drag and not a press on the gizmo's handles.
    if (Input.getMouseButtonUp(MouseButton.Left) && !this.pressedOnGizmo && this.pressedAt.distanceTo(Input.mousePosition) < 6) {
      this.raycaster.setFromCamera(Input.pointer, this.camera);
      const letters = findObjectsOfType(Rigidbody).map((body) => body.node);
      this.select(this.raycaster.intersectObjects(letters, false)[0]?.object ?? null);
    }
  }

  override lateUpdate() {
    if (this.picked) this.outline.box.setFromObject(this.picked);
  }

  private select(node: Object3D | null) {
    this.picked = node;
    if (node) this.gizmo?.attach(node);
    else this.gizmo?.detach();
    this.outline.visible = node !== null;
  }
}
