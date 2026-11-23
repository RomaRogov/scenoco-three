import { Vector3, type Object3D } from 'three';
import { Behaviour, Ease, LoopType } from '@scenoco-three/core';
import type { Tower } from './Tower';

/** A stone pad a tower can stand on. Tapping it opens the build sheet, or its tower's. */
export class BuildPad extends Behaviour {
  /** The highlight, pulsing while an empty pad is selected. */
  ring: Object3D | null = null;
  tower: Tower | null = null;

  private chosen = false;

  get selected() {
    return this.chosen;
  }

  set selected(on: boolean) {
    this.chosen = on;
    const ring = this.ring;
    if (!ring) return;
    ring.doKill();
    ring.visible = on && !this.tower;
    if (!ring.visible) return;
    ring.scale.set(0.94, 1, 0.94);
    ring.doScale(new Vector3(1.06, 1, 1.06), 0.52).setEase(Ease.InOutSine).setLoops(-1, LoopType.Yoyo);
  }
}
