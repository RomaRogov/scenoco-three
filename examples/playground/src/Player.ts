import { Vector3 } from 'three';
import { Animator, Behaviour, Input, Mathf } from '@scenoco-three/core';
import { CharacterController, Physics, type ControllerColliderHit } from '@scenoco-three/rapier';

/**
 * The player: Unity's CharacterController moved by the axes, as its manual's example does — gravity
 * of its own, a jump that reaches `jumpHeight`, and a push for any body it walks into. Its model's
 * Animator crossfades between the clips that match: Idle, Walking, Running, Jump.
 */
export class Player extends Behaviour {
  /** Metres a second. */
  speed = 5;
  jumpHeight = 1.3;
  /** How hard it shoves a body it walks into, in metres a second. */
  pushPower = 2.5;

  private controller!: CharacterController;
  private animator: Animator | null = null;
  private state = '';
  /** Its own fall speed: a CharacterController has no body, so gravity is the script's. */
  private vertical = 0;
  private readonly motion = new Vector3();

  override awake() {
    this.controller = this.getComponent(CharacterController)!;
    this.animator = this.getComponentInChildren(Animator);
  }

  override update(dt: number) {
    const controller = this.controller;
    // The camera looks down -z: up on the stick is away from it.
    const x = Input.getAxis('Horizontal');
    const z = -Input.getAxis('Vertical');
    const length = Math.min(1, Math.hypot(x, z));

    if (controller.isGrounded && this.vertical < 0) this.vertical = -1; // held to the ground, not falling forever
    if (controller.isGrounded && Input.getButtonDown('Jump')) this.vertical = Math.sqrt(2 * this.jumpHeight * -Physics.gravity.y);
    this.vertical += Physics.gravity.y * dt;

    const scale = length > 0 ? (length / Math.hypot(x, z)) * this.speed * dt : 0;
    controller.move(this.motion.set(x * scale, this.vertical * dt, z * scale));

    // Turned to face where it walks, easing round.
    if (length > 0.1) this.node.rotation.y = Mathf.lerpAngle(this.node.rotation.y, Math.atan2(x, z), 1 - Math.exp(-12 * dt));

    this.animate(!controller.isGrounded ? 'Jump' : length > 0.7 ? 'Running' : length > 0.1 ? 'Walking' : 'Idle');
  }

  /** The clip for what it is doing, faded into over a sixth of a second when it changes. */
  private animate(state: string) {
    if (state === this.state || !this.animator) return;
    this.state = state;
    this.animator.crossFadeInFixedTime(state, 0.15);
  }

  /** Unity's `OnControllerColliderHit`: a body walked into is pushed along — not one stood on. */
  override onControllerColliderHit(hit: ControllerColliderHit) {
    const body = hit.rigidbody;
    if (!body || body.isKinematic || hit.moveDirection.y < -0.3) return;
    body.velocity = new Vector3(hit.moveDirection.x, 0, hit.moveDirection.z).multiplyScalar(this.pushPower);
  }
}
