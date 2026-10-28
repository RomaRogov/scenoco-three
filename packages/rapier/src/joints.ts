import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { Behaviour, service } from '@scenoco-three/core';
import { Physics } from './Physics.js';
import { Rigidbody } from './Rigidbody.js';

/**
 * Unity's `Joint`: ties this node's `Rigidbody` to `connectedBody`, or to the world where there is
 * none, as the two stand when it starts. `anchor` is the point it turns about, in this node's space;
 * the connected side's point is worked out to hold that pose, as Unity's
 * `autoConfigureConnectedAnchor` does. Rapier's own joint is `rapierJoint`.
 */
export abstract class Joint extends Behaviour {
  /** The other body, or null for a point fixed in the world. */
  connectedBody: Rigidbody | null = null;
  /** Where it joins, in this node's space. */
  anchor = new Vector3();
  /** Whether the two joined bodies still collide with each other. */
  enableCollision = false;

  private _joint: RAPIER.ImpulseJoint | null = null;
  private _physics: Physics | null = null;

  /** Rapier's joint, once it has started — for anything Unity's fields do not cover. */
  get rapierJoint(): RAPIER.ImpulseJoint | null {
    return this._joint;
  }

  /** @internal Rapier's joint data, from both bodies' poses and the anchors in their spaces. */
  protected abstract data(frames: JointFrames): RAPIER.JointData;

  /** @internal what the subclass sets on the made joint: limits, motors. */
  protected configure(_joint: RAPIER.ImpulseJoint, _frames: JointFrames): void {}

  // `start`: every body has woken by then, this one's and the connected one's.
  override start(): void {
    this.create();
  }

  override onEnable(): void {
    if (this._started) this.create();
  }

  override onDisable(): void {
    this.remove();
  }

  override onDestroy(): void {
    this.remove();
  }

  private create(): void {
    if (this._joint) return;
    const own = this.getComponent(Rigidbody);
    if (!own?._body) {
      throw new Error(`${this.constructor.name} on "${this.node.name}" needs a Rigidbody on the same node, as in Unity: <Rigidbody /> beside it.`);
    }
    const physics = (this._physics = service(this.node, Physics));
    const other = this.connectedBody;
    if (other && !other._body) throw new Error(`${this.constructor.name} on "${this.node.name}": its connectedBody has no body yet — is it in the scene, and enabled?`);
    const body2 = other?._body ?? physics._ground();

    const node = this.node;
    const q1 = node.getWorldQuaternion(new Quaternion());
    const q2 = other ? other.node.getWorldQuaternion(new Quaternion()) : new Quaternion();
    const p1 = node.getWorldPosition(new Vector3());
    const p2 = other ? other.node.getWorldPosition(new Vector3()) : new Vector3();
    const world = node.localToWorld(this.anchor.clone());
    const frames: JointFrames = {
      anchor1: world.clone().sub(p1).applyQuaternion(q1.clone().invert()),
      anchor2: world.clone().sub(p2).applyQuaternion(q2.clone().invert()),
      rotation1: q1,
      rotation2: q2,
      world,
    };
    const joint = physics.world.createImpulseJoint(this.data(frames), own._body, body2, true);
    joint.setContactsEnabled(this.enableCollision);
    this.configure(joint, frames);
    this._joint = joint;
  }

  private remove(): void {
    const joint = this._joint;
    const world = this._physics?.world;
    // A body that went away took its joints with it.
    if (joint && world && world.getImpulseJoint(joint.handle)) world.removeImpulseJoint(joint, true);
    this._joint = null;
  }
}

/** @internal both sides of a joint as it starts. */
export interface JointFrames {
  /** The anchor in each body's space, unscaled. */
  anchor1: Vector3;
  anchor2: Vector3;
  rotation1: Quaternion;
  rotation2: Quaternion;
  /** The anchor in world space. */
  world: Vector3;
}

/** Unity's `FixedJoint`: the two keep the pose they started in, as if glued. */
export class FixedJoint extends Joint {
  protected data({ anchor1, anchor2, rotation1, rotation2 }: JointFrames): RAPIER.JointData {
    // Both frames in the world are the first body's rotation: the relative pose is held as it is.
    const frame2 = rotation2.clone().invert().multiply(rotation1);
    return RAPIER.JointData.fixed(anchor1, { x: 0, y: 0, z: 0, w: 1 }, anchor2, frame2);
  }
}

/** Unity's `JointLimits`, in degrees from where the joint started. */
export interface JointLimits {
  min: number;
  max: number;
}

/** Unity's `JointMotor`: turns towards `targetVelocity` degrees a second with at most `force`. */
export interface JointMotor {
  targetVelocity: number;
  force: number;
}

/**
 * Unity's `HingeJoint`: turns only about `axis`, through `anchor` — a door, a wheel, a lever.
 * `useLimits` keeps its angle within `limits`; `useMotor` drives it.
 */
export class HingeJoint extends Joint {
  /** The axis it turns about, in this node's space. */
  axis = new Vector3(1, 0, 0);
  useLimits = false;
  limits: JointLimits = { min: 0, max: 0 };
  useMotor = false;
  motor: JointMotor = { targetVelocity: 0, force: 0 };

  protected data({ anchor1, anchor2, rotation1, rotation2 }: JointFrames): RAPIER.JointData {
    const axis1 = this.axis.clone().normalize();
    const axis2 = axis1.clone().applyQuaternion(rotation1).applyQuaternion(rotation2.clone().invert());
    return RAPIER.JointData.revoluteWithAxes(anchor1, anchor2, axis1, axis2);
  }

  protected override configure(joint: RAPIER.ImpulseJoint, frames: JointFrames): void {
    const hinge = joint as RAPIER.RevoluteImpulseJoint;
    if (this.useLimits) {
      // Unity measures from the pose the joint started in; Rapier from frames it builds from each
      // axis — the angle between those, now, is where Unity's zero is.
      const zero = startAngle(this.axis.clone().normalize(), frames);
      hinge.setLimits(zero + (this.limits.min * Math.PI) / 180, zero + (this.limits.max * Math.PI) / 180);
    }
    if (this.useMotor) {
      hinge.configureMotorVelocity((this.motor.targetVelocity * Math.PI) / 180, 1);
      hinge.setMotorMaxForce(this.motor.force);
    }
  }
}

/**
 * Unity's `SpringJoint`: pulls the two back to the distance they started at, like a spring —
 * `spring` how hard, `damper` how much it settles.
 */
export class SpringJoint extends Joint {
  spring = 10;
  damper = 0.2;

  protected data({ anchor1, world }: JointFrames): RAPIER.JointData {
    // The connected side's point is its body's origin; with none, where the anchor started.
    const other = this.connectedBody;
    const rest = other ? world.distanceTo(other.node.getWorldPosition(new Vector3())) : 0;
    return RAPIER.JointData.spring(rest, this.spring, this.damper, anchor1, other ? { x: 0, y: 0, z: 0 } : world);
  }
}

/**
 * The angle Rapier reads for a revolute joint in the pose it is made in. Its frame on each body
 * turns x onto that body's axis by the shortest arc; the angle is how far the second frame is
 * turned from the first, about the shared axis.
 */
function startAngle(axis1: Vector3, { rotation1, rotation2 }: JointFrames): number {
  const x = new Vector3(1, 0, 0);
  const axis2 = axis1.clone().applyQuaternion(rotation1).applyQuaternion(rotation2.clone().invert());
  const frame1 = rotation1.clone().multiply(new Quaternion().setFromUnitVectors(x, axis1));
  const frame2 = rotation2.clone().multiply(new Quaternion().setFromUnitVectors(x, axis2));
  const relative = frame1.clone().invert().multiply(frame2);
  // A rotation about x: its angle, signed by its x part.
  return 2 * Math.atan2(relative.x, relative.w);
}
