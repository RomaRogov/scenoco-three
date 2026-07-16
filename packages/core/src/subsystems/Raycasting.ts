import { Raycaster } from 'three';
import type { Camera, Intersection, Object3D, Vector2 } from 'three';

/**
 * Scene picking — a thin wrapper over Three.js's own `Raycaster`. This is a
 * geometric query on the scene graph (what does a ray through the camera hit),
 * **not** physics: colliders and rigid bodies live in the physics add-on packages
 * (`@scenoco-three/rapier` / `box2d`), which never touch this. The `Engine` owns
 * one instance and exposes it through `engine.raycast()`; the engine fills in the
 * defaults (main camera, pointer NDC, the scene's children).
 */
export class Raycasting {
  private readonly raycaster = new Raycaster();

  /**
   * Cast a ray from `camera` through normalized device coords `ndc` and return the
   * hits (nearest first). Updates the camera's world matrix first so a cast that
   * runs before the first render (or headless) doesn't use a stale matrix.
   */
  cast(camera: Camera, ndc: Vector2, objects: Object3D[], recursive: boolean): Intersection[] {
    camera.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, camera);
    return this.raycaster.intersectObjects(objects, recursive);
  }
}
