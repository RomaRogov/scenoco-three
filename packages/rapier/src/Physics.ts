import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3, type Object3D } from 'three';
import { System, Time } from '@scenoco-three/core';
import type { Collider } from './Collider.js';
import { RigidBody } from './RigidBody.js';

/**
 * The 3D physics world, on Rapier.
 *
 * ```xml
 * <Scene>
 *   <Systems>
 *     <Physics gravity="x: 0; y: -9.81; z: 0" />
 *   </Systems>
 * </Scene>
 * ```
 *
 * Declaring it is optional: the first `<RigidBody>` calls `requireSystem` and gets a world with
 * default gravity. Declaring one only configures it.
 *
 * **Rapier loads as WebAssembly, so `await initRapier()` before the first scene loads.** That
 * is the one thing this package needs that `@scenoco-three/box2d` does not.
 *
 * ### What this no longer does
 *
 * v1 rebuilt its picture of the world every fixed step — create bodies for new components,
 * remove them for gone ones, diff each node's colliders. All of it is gone: a body joins in
 * `awake` and leaves in `onDestroy`, and a collider attaches itself. The system holds a world
 * and steps it.
 */
export class Physics extends System {
  /** Gravity, in metres per second squared. */
  gravity = new Vector3(0, -9.81, 0);

  /** The live Rapier world. Reach for it when the wrapper does not expose something. */
  world!: RAPIER.World;

  private events!: RAPIER.EventQueue;
  /** Every body in the world, so `update` can interpolate the dynamic ones. */
  private readonly bodies = new Set<RigidBody>();
  /** Per dynamic body, its two most recent fixed poses. */
  private readonly poses = new Map<RigidBody, Pose>();
  /** Handles of colliders removed since the last step, still named by that step's events. */
  private readonly retired: number[] = [];
  /** Rapier collider handle → the node and sensor flag, for resolving contact events. */
  private readonly colliders = new Map<number, { node: Object3D; sensor: boolean }>();
  private readonly contacts: QueuedContact[] = [];

  override awake(): void {
    if (typeof RAPIER.World !== 'function') {
      throw new Error(
        '[scenoco] Rapier is not initialised. `await initRapier()` before loading a scene — ' +
          'Rapier is WebAssembly, so it cannot be ready at import time.',
      );
    }
    this.world = new RAPIER.World({ x: this.gravity.x, y: this.gravity.y, z: this.gravity.z });
    this.events = new RAPIER.EventQueue(true);
  }

  override onDestroy(): void {
    for (const rigidBody of this.bodies) rigidBody.body = null;
    this.bodies.clear();
    this.poses.clear();
    this.colliders.clear();
    this.contacts.length = 0;
    this.events.free();
    this.world.free();
  }

  // --- membership ------------------------------------------------------------------------

  /** @internal called by `RigidBody.awake`. */
  createBody(rigidBody: RigidBody): RAPIER.RigidBody {
    const position = rigidBody.object3D.getWorldPosition(SCRATCH_POSITION);
    const rotation = rigidBody.object3D.getWorldQuaternion(SCRATCH_ROTATION);
    const body = this.world.createRigidBody(
      rigidBody
        .describe()
        .setTranslation(position.x, position.y, position.z)
        .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w })
        .setLinearDamping(rigidBody.linearDamping)
        .setAngularDamping(rigidBody.angularDamping)
        .setGravityScale(rigidBody.gravityScale)
        .setCcdEnabled(rigidBody.ccd),
    );
    this.bodies.add(rigidBody);
    if (rigidBody.kind === 'dynamic') this.poses.set(rigidBody, poseOf(body));
    return body;
  }

  /** @internal called by `RigidBody.onDestroy`. */
  destroyBody(rigidBody: RigidBody): void {
    if (rigidBody.body) {
      // Removing a body removes its colliders, and Rapier reports a stopped event for each pair
      // they were in on the next step — which is how the other side hears its exit, as it does
      // in Unity. Those events name the handles, so the handles stay resolvable until that step
      // has been drained; deleting them here would have silently dropped every such exit, and
      // never deleting them, which is what this did before, leaked one entry per collider.
      for (let i = 0; i < rigidBody.body.numColliders(); i++) {
        this.retired.push(rigidBody.body.collider(i).handle);
      }
      this.world.removeRigidBody(rigidBody.body);
    }
    this.bodies.delete(rigidBody);
    this.poses.delete(rigidBody);
  }

  /** @internal called by `RigidBody.attachCollider`. */
  createCollider(collider: Collider, owner: RigidBody): RAPIER.Collider {
    const created = this.world.createCollider(collider.toDesc(), owner.body ?? undefined);
    // A contact event carries collider handles, so the mapping back to a node lives here.
    this.colliders.set(created.handle, { node: owner.object3D, sensor: collider.isSensor });
    return created;
  }

  /** @internal called by `RigidBody.detachCollider`. */
  destroyCollider(collider: RAPIER.Collider): void {
    // Kept resolvable until the stopped events naming it are drained — see `destroyBody`.
    this.retired.push(collider.handle);
    this.world.removeCollider(collider, true);
  }

  /** @internal drop the interpolation history, so a teleport does not blend across the jump. */
  resetInterpolation(rigidBody: RigidBody): void {
    if (rigidBody.body && this.poses.has(rigidBody)) {
      this.poses.set(rigidBody, poseOf(rigidBody.body));
    }
  }

  // --- the step --------------------------------------------------------------------------

  override fixedUpdate(dt: number): void {
    // Kinematic bodies are driven by their node: game code moves the node, the body follows.
    // Every `fixedUpdate` that moves one has already run, which is why a system's phase comes
    // after a component's.
    for (const rigidBody of this.bodies) {
      if (rigidBody.kind === 'kinematic' && rigidBody.isActiveAndEnabled) rigidBody.syncFromNode();
    }

    this.world.timestep = dt;
    this.world.step(this.events);
    this.drainEvents();

    for (const rigidBody of this.bodies) {
      if (!rigidBody.isActiveAndEnabled || !rigidBody.body) continue;
      const pose = this.poses.get(rigidBody);
      // Dynamic bodies record two poses for `update` to blend; everything else writes straight
      // through, because there is nothing to interpolate.
      if (pose) advance(pose, rigidBody.body, dt);
      else writeThrough(rigidBody);
    }

    this.flushContacts();
  }

  /**
   * Blend each dynamic body's node between its last two fixed poses, so motion stays smooth
   * when the render rate and the fixed rate differ.
   */
  override update(): void {
    const t = Time.interpolationAlpha;
    for (const [rigidBody, pose] of this.poses) {
      // A disabled body's node belongs to whatever script disabled it.
      if (!rigidBody.isActiveAndEnabled) continue;
      rigidBody.object3D.position.lerpVectors(pose.previousPosition, pose.position, t);
      rigidBody.object3D.quaternion.slerpQuaternions(pose.previousRotation, pose.rotation, t);
    }
  }

  // --- contacts --------------------------------------------------------------------------

  private drainEvents(): void {
    this.events.drainCollisionEvents((first, second, started) => {
      const a = this.colliders.get(first);
      const b = this.colliders.get(second);
      if (!a || !b) return;
      this.contacts.push({
        a: a.node,
        b: b.node,
        sensor: a.sensor || b.sensor,
        phase: started ? 'enter' : 'exit',
      });
    });
    // Every event a removed collider was going to be named in has now been read.
    for (const handle of this.retired) this.colliders.delete(handle);
    this.retired.length = 0;
  }

  private flushContacts(): void {
    // Both sides hear about it, and both hear the same thing. Dispatched after the step, so a
    // hook is free to destroy things without splicing the world mid-simulation.
    for (const { a, b, sensor, phase } of this.contacts) {
      dispatch(a, b, sensor, phase);
      dispatch(b, a, sensor, phase);
    }
    this.contacts.length = 0;
  }
}

type ContactPhase = 'enter' | 'exit';

interface QueuedContact {
  a: Object3D;
  b: Object3D;
  sensor: boolean;
  phase: ContactPhase;
}

/** A dynamic body's two most recent fixed poses. */
interface Pose {
  previousPosition: Vector3;
  previousRotation: Quaternion;
  position: Vector3;
  rotation: Quaternion;
}

function poseOf(body: RAPIER.RigidBody): Pose {
  const t = body.translation();
  const r = body.rotation();
  return {
    previousPosition: new Vector3(t.x, t.y, t.z),
    previousRotation: new Quaternion(r.x, r.y, r.z, r.w),
    position: new Vector3(t.x, t.y, t.z),
    rotation: new Quaternion(r.x, r.y, r.z, r.w),
  };
}

/**
 * Shift current → previous and record the new pose.
 *
 * A move far larger than this step's velocity allows is a teleport — a respawn, a manual
 * `setPosition` — so the previous pose snaps to it rather than being blended across the jump.
 * The threshold scales with speed, so a genuinely fast body is not mistaken for one.
 */
function advance(pose: Pose, body: RAPIER.RigidBody, dt: number): void {
  const t = body.translation();
  const r = body.rotation();
  const v = body.linvel();
  const moved = Math.hypot(t.x - pose.position.x, t.y - pose.position.y, t.z - pose.position.z);
  const allowed = Math.hypot(v.x, v.y, v.z) * dt * TELEPORT_FACTOR + TELEPORT_MARGIN;

  if (moved > allowed) {
    pose.previousPosition.set(t.x, t.y, t.z);
    pose.previousRotation.set(r.x, r.y, r.z, r.w);
  } else {
    pose.previousPosition.copy(pose.position);
    pose.previousRotation.copy(pose.rotation);
  }
  pose.position.set(t.x, t.y, t.z);
  pose.rotation.set(r.x, r.y, r.z, r.w);
}

/** Non-dynamic bodies have nothing to blend: the world's pose is the node's pose. */
function writeThrough(rigidBody: RigidBody): void {
  const t = rigidBody.body!.translation();
  const r = rigidBody.body!.rotation();
  rigidBody.object3D.position.set(t.x, t.y, t.z);
  rigidBody.object3D.quaternion.set(r.x, r.y, r.z, r.w);
}

const TELEPORT_FACTOR = 4;
const TELEPORT_MARGIN = 0.1;

/** Call every contact hook on `node` that wants to hear about `other`. */
function dispatch(node: Object3D, other: Object3D, sensor: boolean, phase: ContactPhase): void {
  for (const component of node.components) {
    // Enqueued for destruction this frame: it should not act on a contact it will not survive.
    if (component.isDestroyed || component._pendingDestroy) continue;
    const hook = sensor
      ? phase === 'enter'
        ? component.onTriggerEnter
        : component.onTriggerExit
      : phase === 'enter'
        ? component.onCollisionEnter
        : component.onCollisionExit;
    hook?.call(component, other);
  }
}

const SCRATCH_POSITION = new Vector3();
const SCRATCH_ROTATION = new Quaternion();
