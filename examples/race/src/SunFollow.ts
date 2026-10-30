import { Vector3, type DirectionalLight } from 'three';
import { Behaviour } from '@scenoco-three/core';

/**
 * Keeps a directional light's shadows where the camera is looking, rather than over the whole map:
 * the light keeps its direction and moves with a point `ahead` metres in front of the camera, its
 * shadow box `radius` metres each way around that point. A small box at a small map is as sharp as a
 * big box at a big one, for a quarter of the pixels drawn each frame — on a tablet, the difference
 * between 53 and 60 fps. The point snaps to the shadow map's texels, so edges do not crawl as it moves.
 */
export class SunFollow extends Behaviour<DirectionalLight> {
  radius = 45;
  ahead = 25;
  mapSize = 2048;

  /**
   * The largest shadow map any sun may use, 0 for none: lowered where the device cannot keep up.
   * Static, so the next race loads with it too. A 2048 map on a 640-pixel screen is sixteen screens
   * of pixels to clear and draw into each frame, and on a weak GPU the larger part of the frame.
   */
  static limit = 2048;

  private readonly offset = new Vector3();
  private readonly centre = new Vector3();
  private readonly forward = new Vector3();

  override awake(): void {
    const light = this.node;
    // The direction the scene gave it: from where it is, toward its target.
    this.offset.copy(light.position).sub(light.target.position);
    const box = light.shadow.camera;
    box.left = box.bottom = -this.radius;
    box.right = box.top = this.radius;
    box.near = 1;
    box.far = this.offset.length() + this.radius * 2;
    box.updateProjectionMatrix();
  }

  override lateUpdate(): void {
    this.fitMap();
    const camera = this.camera;
    if (!camera) return;
    camera.getWorldPosition(this.centre);
    camera.getWorldDirection(this.forward).setY(0).normalize();
    this.centre.addScaledVector(this.forward, this.ahead);
    const texel = (this.radius * 2) / this.node.shadow.mapSize.x;
    this.centre.set(Math.round(this.centre.x / texel) * texel, 0, Math.round(this.centre.z / texel) * texel);
    const light = this.node;
    light.target.position.copy(this.centre);
    light.target.updateMatrixWorld();
    light.position.copy(this.centre).add(this.offset);
  }

  /** The map at `mapSize`, or as much of it as `limit` allows; no shadow at all at a limit of 0. */
  private fitMap(): void {
    const light = this.node;
    if (SunFollow.limit <= 0) {
      light.castShadow = false;
      return;
    }
    const size = Math.min(this.mapSize, SunFollow.limit);
    if (light.shadow.mapSize.x === size) return;
    light.shadow.mapSize.set(size, size);
    // Made again at the new size on the next draw.
    light.shadow.map?.dispose();
    light.shadow.map = null;
  }
}
