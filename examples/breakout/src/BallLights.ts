import { PointLight, Vector3, type Object3D } from 'three';
import { Behaviour, findObjectsOfType } from '@scenoco-three/core';
import { Ball } from './Ball.js';

/**
 * The balls' glow: the point lights under this node, each following a ball, the spare ones dark.
 *
 * Why not a light in the ball prefab: three.js compiles the number of lights into every lit
 * material's shader, so each new count — a multi-ball's three balls, then nine, then one fewer as
 * each falls — recompiles them all, a frame of 200 ms. These lights are always here, so the count
 * never changes; a ball past the last light simply has none.
 */
export class BallLights extends Behaviour<Object3D> {
  /**
   * Off where the device cannot keep up: each point light is paid at every pixel of every lit
   * surface, and on a weak GPU four of them cost a third of the frame. Static, so the next level
   * loads without them too; hidden rather than dimmed, so the shaders leave them out.
   */
  static on = true;

  private lights: PointLight[] = [];
  private intensities: number[] = [];
  private readonly at = new Vector3();

  override awake(): void {
    this.lights = this.node.children.filter((c): c is PointLight => c instanceof PointLight);
    this.intensities = this.lights.map((l) => l.intensity);
  }

  override lateUpdate(): void {
    for (const light of this.lights) light.visible = BallLights.on;
    if (!BallLights.on) return;
    const balls = findObjectsOfType(Ball);
    this.lights.forEach((light, i) => {
      const ball = balls[i];
      light.intensity = ball ? this.intensities[i]! : 0;
      if (ball) light.position.copy(this.node.worldToLocal(ball.node.getWorldPosition(this.at)));
    });
  }
}
