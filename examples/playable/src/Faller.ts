import { Vector3 } from 'three';
import { Component, Time } from '@scenoco-three/core';
import { Round } from './Round.js';

/**
 * Falls, and is a miss if it reaches the floor.
 *
 * No physics package: a playable ad wants to load in a couple of hundred kilobytes, and a
 * constant-velocity drop is the whole simulation. Reach for `@scenoco-three/box2d` when the
 * mechanic actually needs contacts.
 *
 * The floor is a **world** height, and the check reads a world position to match. A spawner
 * drops these as its own children, so `position.y` here is measured from the spawner — nine
 * units up — and comparing that against a world floor lands them near the top of the screen and
 * loses the round in eight seconds. Local and world are the easiest two things in a scene graph
 * to confuse, and the symptom looks like difficulty rather than a bug.
 */
export class Faller extends Component {
  speed = 3.2;
  /** World height below which it counts as missed. */
  floor = -5.5;

  private readonly world = new Vector3();
  private round!: Round;

  override awake(): void {
    this.round = this.requireSystem(Round);
  }

  override update(dt: number): void {
    if (this.round.phase !== 'playing') return;
    this.object3D.position.y -= this.speed * dt;
    if (this.object3D.getWorldPosition(this.world).y > this.floor) return;
    this.round.miss();
    this.object3D.destroy();
  }
}
