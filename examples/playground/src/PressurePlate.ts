import { Color, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { Behaviour, Ease, sendMessage } from '@scenoco-three/core';
import type { Collider } from '@scenoco-three/rapier';
import { Player } from './Player';

/**
 * A plate that sinks under the player and tells `target` so with Unity's `SendMessage` — by method
 * name, to whatever behaviours that node has, without knowing their classes.
 */
export class PressurePlate extends Behaviour<Mesh> {
  target: Object3D | null = null;
  /** The method called on the target's behaviours. */
  message = 'toggle';

  private readonly lit = new Color('#ffd34d');
  private readonly rest = new Color();

  override start() {
    this.rest.copy(this.material.color);
  }

  override onTriggerEnter(other: Collider) {
    if (!other.getComponent(Player)) return;
    this.node.doLocalMoveY(-0.06, 0.12).setRelative().setEase(Ease.OutQuad);
    this.material.doColor(this.lit, 0.12).setLink(this);
    if (this.target) sendMessage(this.target, this.message);
  }

  override onTriggerExit(other: Collider) {
    if (!other.getComponent(Player)) return;
    this.node.doLocalMoveY(0.06, 0.25).setRelative().setEase(Ease.OutBack);
    this.material.doColor(this.rest, 0.25).setLink(this);
  }

  private get material(): MeshStandardMaterial {
    return this.node.material as MeshStandardMaterial;
  }
}
