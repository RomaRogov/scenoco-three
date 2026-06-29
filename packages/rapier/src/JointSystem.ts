import RAPIER from '@dimforge/rapier3d-compat';
import type { Object3D } from 'three';
import { System, system } from '@scenoco-three/core';
import { Joint } from './Joint.js';
import { RigidBody } from './RigidBody.js';
import { PhysicsSystem } from './PhysicsSystem.js';

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

/**
 * Manages physics joints declared with `<Joint>`, on the public `System` seam.
 * Reaches the `PhysicsSystem`'s world + bodies via `engine.getSystem`, creating
 * a Rapier impulse joint once both connected bodies exist (within a frame or two
 * of load) and removing it when the component leaves.
 */
@system(Joint)
export class JointSystem extends System<Joint> {
  private readonly joints = new Map<Joint, RAPIER.ImpulseJoint>();

  override fixedStep(): void {
    const physics = this.engine.getSystem(PhysicsSystem);
    const world = physics?.world;
    if (!physics || !world) return;

    // Create joints whose bodies are now built.
    for (const joint of this.components) {
      if (this.joints.has(joint)) continue;
      const a = this.bodyOf(physics, joint.node);
      const b = joint.connectedBody ? this.bodyOf(physics, joint.connectedBody) : undefined;
      if (!a || !b) continue; // bodies not ready yet — retry next step
      this.joints.set(joint, world.createImpulseJoint(jointData(joint), a, b, true));
    }
    // Remove joints whose component left the scene.
    for (const [joint, handle] of this.joints) {
      if (!this.components.includes(joint)) {
        world.removeImpulseJoint(handle, true);
        this.joints.delete(joint);
      }
    }
  }

  override onDetach(): void {
    const world = this.engine.getSystem(PhysicsSystem)?.world;
    if (world) for (const handle of this.joints.values()) world.removeImpulseJoint(handle, true);
    this.joints.clear();
  }

  /** The Rapier body for a node's RigidBody, if it has one and it's been built. */
  private bodyOf(physics: PhysicsSystem, node: Object3D): RAPIER.RigidBody | undefined {
    for (const c of this.engine.getComponents(node)) {
      if (c instanceof RigidBody) return physics.bodyFor(c);
    }
    return undefined;
  }
}

function jointData(joint: Joint): RAPIER.JointData {
  const a = { x: joint.anchor.x, y: joint.anchor.y, z: joint.anchor.z };
  const b = { x: joint.connectedAnchor.x, y: joint.connectedAnchor.y, z: joint.connectedAnchor.z };
  const axis = { x: joint.axis.x, y: joint.axis.y, z: joint.axis.z };
  switch (joint.kind) {
    case 'revolute':
      return RAPIER.JointData.revolute(a, b, axis);
    case 'spherical':
      return RAPIER.JointData.spherical(a, b);
    case 'prismatic':
      return RAPIER.JointData.prismatic(a, b, axis);
    case 'spring':
      return RAPIER.JointData.spring(joint.restLength, joint.stiffness, joint.damping, a, b);
    default:
      return RAPIER.JointData.fixed(a, IDENTITY, b, IDENTITY);
  }
}
