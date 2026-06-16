import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { System, system } from '@scenoco-three/core';
import { RigidBody } from './RigidBody.js';
import { Collider } from './Collider.js';
import { Physics } from './Physics.js';

/**
 * ECS-hybrid physics: registered for `RigidBody`, the engine auto-runs it while
 * the scene contains rigid bodies and keeps `this.components` in sync. Each fixed
 * step it reconciles the Rapier world with the live component set (creating a
 * body for each new `RigidBody`, removing one whose component left), steps the
 * world, then writes every body's pose back to its `Object3D`. Gravity comes from
 * the `<Physics>` config attachment, read on attach.
 *
 * Requires `await initRapier()` before `loadScene`.
 */
@system(RigidBody)
export class PhysicsSystem extends System<RigidBody> {
  world?: RAPIER.World;
  private readonly bodies = new Map<RigidBody, RAPIER.RigidBody>();
  private readonly v = new Vector3();
  private readonly q = new Quaternion();

  override onAttach(): void {
    if (typeof RAPIER.World !== 'function') {
      throw new Error('Rapier is not initialized — call `await initRapier()` before loadScene().');
    }
    const g = this.engine.findAttachment(Physics)?.gravity ?? [0, -9.81, 0];
    this.world = new RAPIER.World({ x: g[0] ?? 0, y: g[1] ?? -9.81, z: g[2] ?? 0 });
  }

  override fixedStep(dt: number): void {
    const world = this.world;
    if (!world) return;
    // Reconcile bodies ↔ live components: create for new, remove for gone.
    for (const rb of this.components) if (!this.bodies.has(rb)) this.createBody(world, rb);
    for (const [rb, body] of this.bodies) {
      if (!this.components.includes(rb)) {
        world.removeRigidBody(body);
        this.bodies.delete(rb);
        rb.body = undefined;
      }
    }
    world.timestep = dt;
    world.step();
    // World → scene graph.
    for (const [rb, body] of this.bodies) {
      const t = body.translation();
      const r = body.rotation();
      rb.node.position.set(t.x, t.y, t.z);
      rb.node.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  override onDetach(): void {
    for (const rb of this.bodies.keys()) rb.body = undefined;
    this.world?.free();
    this.world = undefined;
    this.bodies.clear();
  }

  /** The live Rapier body for a RigidBody, once built (for RigidBody.applyImpulse, etc.). */
  bodyFor(rb: RigidBody): RAPIER.RigidBody | undefined {
    return this.bodies.get(rb);
  }

  private createBody(world: RAPIER.World, rb: RigidBody): void {
    rb.node.getWorldPosition(this.v);
    rb.node.getWorldQuaternion(this.q);
    const desc = descForKind(rb.kind)
      .setTranslation(this.v.x, this.v.y, this.v.z)
      .setRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w })
      .setLinearDamping(rb.linearDamping)
      .setAngularDamping(rb.angularDamping)
      .setGravityScale(rb.gravityScale);
    const body = world.createRigidBody(desc);
    this.bodies.set(rb, body);
    rb.body = body;
    // Attach the colliders declared on the same node.
    for (const c of rb.engine.getComponents(rb.node)) {
      if (c instanceof Collider) world.createCollider(c.toDesc(), body);
    }
  }
}

function descForKind(kind: string): RAPIER.RigidBodyDesc {
  if (kind === 'fixed') return RAPIER.RigidBodyDesc.fixed();
  if (kind === 'kinematic') return RAPIER.RigidBodyDesc.kinematicPositionBased();
  return RAPIER.RigidBodyDesc.dynamic();
}
