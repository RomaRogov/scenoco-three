import { Vector3, type Object3D } from 'three';
import { Component, Time } from '@scenoco-three/core';

/**
 * The stack on the player's back.
 *
 * A picked-up crate is **reparented** onto the carrier rather than copied or tracked in a list of
 * positions, so it keeps being an ordinary node: it draws itself, it can be handed on to the
 * depot, and nothing has to remember what it looked like.
 *
 * Each crate eases towards its slot instead of snapping to it, which is the whole look of this
 * genre — the stack sways behind you when you turn, and settles when you stop.
 */
export class Carrier extends Component {
  /** How many it can hold. A full carrier walks past pickups. */
  capacity = 12;
  /** Height of one crate in the stack. */
  spacing = 0.42;
  /** Where the bottom of the stack sits, above the carrier's own origin. */
  offset = 0.55;
  /** How quickly a crate catches up with its slot. Higher is stiffer. */
  stiffness = 12;

  private readonly carried: Object3D[] = [];
  private readonly slot = new Vector3();

  get count(): number {
    return this.carried.length;
  }

  get full(): boolean {
    return this.carried.length >= this.capacity;
  }

  /** Take a crate out of the world and onto the stack. False when there is no room. */
  take(crate: Object3D): boolean {
    if (this.full) return false;
    // `attach` and not `add`: it keeps the crate where it is on screen while changing whose
    // child it is, so the pickup eases up onto the stack instead of teleporting to the player.
    this.object3D.attach(crate);
    this.carried.push(crate);
    return true;
  }

  /** Hand the whole stack over, bottom first. The caller owns them now. */
  drain(): Object3D[] {
    const given = [...this.carried];
    this.carried.length = 0;
    return given;
  }

  override update(): void {
    const ease = 1 - Math.exp(-this.stiffness * Time.deltaTime);
    for (const [index, crate] of this.carried.entries()) {
      this.slot.set(0, this.offset + index * this.spacing, 0);
      crate.position.lerp(this.slot, ease);
      crate.quaternion.slerp(this.object3D.quaternion.clone().invert(), ease);
    }
  }
}
