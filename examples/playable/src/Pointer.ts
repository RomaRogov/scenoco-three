import { Raycaster, type Object3D } from 'three';
import { Input, MouseButton, System } from '@scenoco-three/core';
import './taps.js';

/**
 * Turns a tap into `onTap` on whatever was under it.
 *
 * A scene service rather than a component, because it belongs to no node: there is one pointer,
 * it is read once a frame, and everything that cares hears about it. The same shape as a physics
 * world — nothing queries it, things register by implementing the hook.
 *
 * `Input.pointer` is already in normalized device coordinates, which is what
 * `Raycaster.setFromCamera` wants; the camera is whichever one the scene declared.
 *
 * It walks **every** intersection rather than taking the nearest, and stops at the first that
 * wants to hear about it. A screen-space HUD is parented to the camera and therefore sits in
 * front of the entire scene, so the nearest hit is almost always a UI panel — taking hit zero
 * means every tap lands on the interface and the game never receives one.
 */
export class Pointer extends System {
  private readonly raycaster = new Raycaster();

  override update(): void {
    if (!Input.getMouseButtonDown(MouseButton.Left)) return;
    const camera = this.scene.mainCamera;
    if (!camera) return;

    this.raycaster.setFromCamera(Input.pointer, camera);
    for (const hit of this.raycaster.intersectObjects(this.scene.children, true)) {
      // Up the tree from what the ray struck: the mesh that was hit is often a child of the node
      // carrying the behaviour, and a tap on a turret's barrel is a tap on the turret.
      for (let node: Object3D | null = hit.object; node; node = node.parent) {
        let handled = false;
        for (const component of node.components) {
          if (component.isDestroyed || !component.onTap) continue;
          component.onTap(hit.object);
          handled = true;
        }
        if (handled) return;
      }
    }
  }
}
