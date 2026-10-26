import type { Object3D } from 'three';
import { Behaviour } from '@scenoco-three/core';
import type { Tower } from './Tower';

/** A stone pad a tower can stand on. Tapping it opens the build sheet, or its tower's. */
export class BuildPad extends Behaviour {
  /** The highlight shown while it is selected. */
  ring: Object3D | null = null;
  tower: Tower | null = null;
  selected = false;

  private time = 0;

  override update(dt: number) {
    const ring = this.ring;
    if (!ring) return;
    ring.visible = this.selected && !this.tower;
    if (!ring.visible) return;
    this.time += dt;
    const pulse = 1 + Math.sin(this.time * 6) * 0.06;
    ring.scale.set(pulse, 1, pulse);
  }
}
