import type { Object3D, Vector3 } from 'three';
import { Behaviour } from '@scenoco-three/core';


/** The selected tower's reach, drawn on the ground: a soft disc and its edge. */
export class SelectionMarker extends Behaviour {
  range: Object3D | null = null;

  private radius = 1;
  private shown = 0;
  private time = 0;

  override awake() {
    this.node.visible = false;
  }

  /** Show `radius` units of reach around a point on the ground. */
  show(at: Vector3, radius: number) {
    this.node.position.copy(at);
    this.node.position.y += 0.08;
    this.radius = radius;
    if (!this.node.visible) this.shown = 0;
    this.node.visible = true;
  }

  hide() {
    this.node.visible = false;
  }

  override update(dt: number) {
    if (!this.node.visible) return;
    this.time += dt;
    // Grows out to its radius, then breathes.
    this.shown = Math.min(1, this.shown + dt * 5);
    const ease = 1 - Math.pow(1 - this.shown, 3);
    const r = this.radius * ease * (1 + Math.sin(this.time * 3) * 0.01);
    this.range?.scale.set(r, 1, r);
  }
}
