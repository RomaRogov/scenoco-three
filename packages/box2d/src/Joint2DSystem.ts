import { DistanceJoint, PrismaticJoint, RevoluteJoint, Vec2, WeldJoint, WheelJoint, type Body, type Joint } from 'planck';
import type { Object3D } from 'three';
import { System, system } from '@scenoco-three/core';
import { Joint2D } from './Joint2D.js';
import { RigidBody2D } from './RigidBody2D.js';
import { Physics2DSystem } from './Physics2DSystem.js';

/**
 * Manages 2D joints declared with `<Joint2D>`, on the public `System` seam.
 * Reaches the `Physics2DSystem`'s world via `engine.getSystem` and each body via
 * the live `RigidBody2D.body`, creating a planck joint once both bodies exist and
 * destroying it when the component leaves.
 */
@system(Joint2D)
export class Joint2DSystem extends System<Joint2D> {
  private readonly joints = new Map<Joint2D, Joint>();

  override fixedStep(): void {
    const world = this.engine.getSystem(Physics2DSystem)?.world;
    if (!world) return;

    for (const joint of this.components) {
      if (this.joints.has(joint)) continue;
      const a = this.bodyOf(joint.node);
      const b = joint.connectedBody ? this.bodyOf(joint.connectedBody) : undefined;
      if (!a || !b) continue; // bodies not built yet — retry next step
      const created = world.createJoint(makeJoint(joint, a, b));
      if (created) this.joints.set(joint, created);
    }
    for (const [joint, handle] of this.joints) {
      if (!this.components.includes(joint)) {
        world.destroyJoint(handle);
        this.joints.delete(joint);
      }
    }
  }

  override onDetach(): void {
    const world = this.engine.getSystem(Physics2DSystem)?.world;
    if (world) for (const handle of this.joints.values()) world.destroyJoint(handle);
    this.joints.clear();
  }

  private bodyOf(node: Object3D): Body | undefined {
    for (const c of this.engine.getComponents(node)) {
      if (c instanceof RigidBody2D) return c.body;
    }
    return undefined;
  }
}

function makeJoint(joint: Joint2D, a: Body, b: Body): Joint {
  const anchorA = a.getWorldPoint(new Vec2(joint.anchor.x, joint.anchor.y));
  const axis = new Vec2(joint.axis.x, joint.axis.y);
  switch (joint.kind) {
    case 'distance':
      return new DistanceJoint(
        { frequencyHz: joint.frequency, dampingRatio: joint.damping },
        a,
        b,
        anchorA,
        b.getWorldPoint(new Vec2(joint.connectedAnchor.x, joint.connectedAnchor.y)),
      );
    case 'prismatic':
      return new PrismaticJoint({}, a, b, anchorA, axis);
    case 'weld':
      return new WeldJoint({}, a, b, anchorA);
    case 'wheel':
      return new WheelJoint({}, a, b, anchorA, axis);
    default:
      return new RevoluteJoint({}, a, b, anchorA);
  }
}
