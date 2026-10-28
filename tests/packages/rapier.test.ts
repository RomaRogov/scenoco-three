import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { BoxGeometry, BufferAttribute, BufferGeometry, ConeGeometry, Mesh, Object3D, Quaternion, Ray, Scene, SphereGeometry, Vector3 } from 'three';
import { Behaviour, Event, Runtime, destroy, service } from '@scenoco-three/core';
import {
  BoxCollider,
  CapsuleCollider,
  CharacterController,
  CollisionFlags,
  FixedJoint,
  HingeJoint,
  QueryTriggerInteraction,
  SpringJoint,
  MeshCollider,
  ForceMode,
  Physics,
  PhysicsMaterial,
  PhysicsMaterialCombine,
  Rigidbody,
  RigidbodyConstraints,
  SphereCollider,
  TerrainCollider,
  initRapier,
  type Collider,
  type Collision,
  type ControllerColliderHit,
} from '@scenoco-three/rapier';

beforeAll(() => initRapier());

const runtimes: Runtime[] = [];
function world() {
  const scene = new Scene();
  const runtime = new Runtime(scene);
  runtimes.push(runtime);
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) runtime.update(1 / 60);
  };
  return { scene, runtime, run };
}
afterEach(() => runtimes.splice(0).forEach((r) => r.dispose()));

/** Writes down every contact message it receives. */
class Ears extends Behaviour {
  heard: string[] = [];
  override onCollisionEnter(c: Collision) { this.heard.push(`collisionEnter:${c.node.name}`); }
  override onCollisionExit(c: Collision) { this.heard.push(`collisionExit:${c.node.name}`); }
  override onTriggerEnter(other: Collider) { this.heard.push(`triggerEnter:${other.node.name}`); }
  override onTriggerExit(other: Collider) { this.heard.push(`triggerExit:${other.node.name}`); }
}

function floor(scene: Scene, options: { trigger?: boolean } = {}) {
  const node = new Object3D();
  node.name = 'floor';
  node.scale.set(10, 1, 10); // the collider scales with it, as in Unity
  scene.add(node);
  node.addComponent(BoxCollider, { isTrigger: options.trigger ?? false }); // no Rigidbody: static
  return node.addComponent(Ears);
}

function ball(scene: Scene, y: number) {
  const node = new Object3D();
  node.name = 'ball';
  node.position.set(0, y, 0);
  scene.add(node);
  const body = node.addComponent(Rigidbody);
  node.addComponent(SphereCollider, { radius: 0.5 });
  return { node, body, ears: node.addComponent(Ears) };
}

describe('rapier', () => {
  it('drops a ball onto a static floor: it lands, and both sides hear the collision', () => {
    const { scene, run } = world();
    const ground = floor(scene);
    const b = ball(scene, 3);
    run(2);
    expect(b.node.position.y).toBeCloseTo(1, 1); // floor top at 0.5, radius 0.5
    expect(b.ears.heard).toContain('collisionEnter:floor');
    expect(ground.heard).toContain('collisionEnter:ball');
  });

  it('lets a ball fall through a trigger, which both sides hear as a trigger', () => {
    const { scene, run } = world();
    const zone = floor(scene, { trigger: true });
    const b = ball(scene, 3);
    run(2);
    expect(b.node.position.y).toBeLessThan(-3);
    expect(b.ears.heard).toEqual(['triggerEnter:floor', 'triggerExit:floor']);
    expect(zone.heard).toEqual(['triggerEnter:ball', 'triggerExit:ball']);
  });

  it('reports a kinematic body moved by its node entering a static trigger, as Unity does', () => {
    const { scene, run } = world();
    const zone = floor(scene, { trigger: true });
    const paddle = new Object3D();
    paddle.name = 'paddle';
    paddle.position.set(0, 3, 0);
    scene.add(paddle);
    paddle.addComponent(Rigidbody, { isKinematic: true });
    paddle.addComponent(BoxCollider);
    run(0.1);
    paddle.position.y = 0; // move the node; the body follows
    run(0.1);
    expect(zone.heard).toContain('triggerEnter:paddle');
  });

  it('switches a body between kinematic and dynamic when isKinematic changes, as Unity does', () => {
    const { scene, run } = world();
    floor(scene);
    const b = ball(scene, 3);
    run(0.2);
    b.body.isKinematic = true; // picked up: the node leads, gravity lets go
    b.node.position.set(2, 4, 0);
    run(0.5);
    expect(b.node.position.y).toBeCloseTo(4, 3);
    expect(b.body.rapierBody!.translation().x).toBeCloseTo(2, 3);
    b.body.isKinematic = false; // let go: it falls from where it was put, still
    run(2);
    expect(b.node.position.x).toBeCloseTo(2, 1);
    expect(b.node.position.y).toBeCloseTo(1, 1);
  });

  it('moves a static collider with its node, so a scrolled pickup reaches a kinematic runner', () => {
    const { scene, run } = world();
    const runner = new Object3D();
    runner.name = 'runner';
    scene.add(runner);
    runner.addComponent(Rigidbody, { isKinematic: true });
    runner.addComponent(BoxCollider);
    const coin = new Object3D();
    coin.name = 'coin';
    coin.position.z = -10;
    scene.add(coin);
    coin.addComponent(BoxCollider, { isTrigger: true }); // no Rigidbody, moved by its node
    const ears = runner.addComponent(Ears);
    for (let i = 0; i < 120; i++) {
      coin.position.z += 10 / 60;
      run(1 / 60);
    }
    expect(ears.heard).toEqual(['triggerEnter:coin', 'triggerExit:coin']);
  });

  it('may destroy in a handler: the object goes, and the other side hears it leave', () => {
    const { scene, run } = world();
    const ground = floor(scene);
    class Fragile extends Behaviour {
      override onCollisionEnter() { destroy(this.node); }
    }
    const b = ball(scene, 2);
    b.node.addComponent(Fragile);
    run(2);
    expect(b.node.parent).toBeNull();
    expect(ground.heard).toEqual(['collisionEnter:ball', 'collisionExit:ball']);
  });

  it('may destroy a pickup from the runner\'s onTriggerEnter', () => {
    const { scene, run } = world();
    const runner = new Object3D();
    scene.add(runner);
    runner.addComponent(Rigidbody, { isKinematic: true });
    runner.addComponent(BoxCollider);
    class Collector extends Behaviour {
      picked = 0;
      override onTriggerEnter(other: Collider) {
        this.picked++;
        destroy(other.node);
      }
    }
    const collector = runner.addComponent(Collector);
    const coin = new Object3D();
    scene.add(coin);
    coin.addComponent(BoxCollider, { isTrigger: true });
    expect(() => run(0.5)).not.toThrow();
    expect(collector.picked).toBe(1);
    expect(coin.parent).toBeNull();
  });

  it('is the ground of a TerrainData, scaled and placed by its node', () => {
    const { scene, run } = world();
    // 5 samples a side over 40 m, a tilted plane: up 3 m a sample along x, 1 m along z.
    const n = 5;
    const heights = Float32Array.from({ length: n * n }, (_, i) => Math.floor(i / n) + 3 * (i % n));
    const terrainData = { url: 'plane.terrain', isLoaded: true, heightmapResolution: n, size: new Vector3(40, 12, 40), heights, changed: new Event() };
    const ground = new Object3D();
    ground.position.set(100, 2, 0);
    ground.scale.setScalar(0.5);
    ground.addComponent(TerrainCollider, { terrainData });
    scene.add(ground);
    const hits: number[] = [];
    class Probe extends Behaviour {
      override fixedUpdate() {
        const physics = service(this.node, Physics);
        hits.length = 0;
        for (const [x, z] of [[104, -3], [97, 6]] as const) {
          const hit = physics.world.castRay(new RAPIER.Ray({ x, y: 50, z }, { x: 0, y: -1, z: 0 }), 100, true);
          hits.push(hit ? 50 - hit.timeOfImpact : NaN);
        }
      }
    }
    const probe = new Object3D();
    probe.addComponent(Probe);
    scene.add(probe);
    run(0.1);
    // (104, -3) is sample column 2.8, row 1.4: 1.4 + 3 × 2.8 = 9.8 m, half scale, on y = 2.
    expect(hits[0]).toBeCloseTo(6.9, 3);
    // (97, 6) is column 1.4, row 3.2: 3.2 + 4.2 = 7.4 m.
    expect(hits[1]).toBeCloseTo(5.7, 3);
    // The heights change in code, and say so: the heightfield is made again.
    heights.fill(0);
    terrainData.changed.emit();
    run(0.1);
    expect(hits[0]).toBeCloseTo(2, 3);
  });

  it('fits a collider left without a size to the meshes on and under its node, and keeps what was written', () => {
    const { scene, run } = world();
    // Off its node's centre, as text geometry is: the box takes its size and its centre.
    const slab = new Mesh(new BoxGeometry(2, 1, 4).translate(1, 0.5, 0));
    const box = slab.addComponent(BoxCollider);
    // A ball under a group, as a loaded model is, scaled by its node.
    const holder = new Object3D();
    holder.scale.setScalar(2);
    holder.add(new Mesh(new SphereGeometry(1.5)));
    const sphere = holder.addComponent(SphereCollider);
    const tall = new Mesh(new BoxGeometry(1, 3, 1));
    const capsule = tall.addComponent(CapsuleCollider, { radius: 0.2 });
    const given = new Mesh(new BoxGeometry(5, 5, 5));
    const kept = given.addComponent(BoxCollider, { size: new Vector3(1, 2, 3) });
    scene.add(slab, holder, tall, given);
    run(0.05);
    expect(box.size.toArray()).toEqual([2, 1, 4]);
    expect(box.center.toArray()).toEqual([1, 0.5, 0]);
    const half = box.rapierCollider!.halfExtents()!;
    expect([half.x, half.y, half.z]).toEqual([1, 0.5, 2]);
    expect(sphere.radius).toBeCloseTo(1.5);
    expect(sphere.rapierCollider!.radius()).toBeCloseTo(3); // the node's scale on top, as for every size
    expect([capsule.radius, capsule.height]).toEqual([0.2, 3]);
    expect(kept.size.toArray()).toEqual([1, 2, 3]);
  });

  it('passes through a layer it ignores, as Unity does, and meets it again when told', () => {
    const { scene, run } = world();
    const ground = floor(scene);
    const { node, ears } = ball(scene, 3);
    node.getComponent(SphereCollider)!.layer = 3;
    Physics.ignoreLayerCollision(0, 3);
    try {
      expect(Physics.getIgnoreLayerCollision(3, 0)).toBe(true);
      run(1);
      expect(node.position.y).toBeLessThan(-1);
      expect(ears.heard).toEqual([]);
      expect(ground.heard).toEqual([]);
      Physics.ignoreLayerCollision(0, 3, false);
      node.position.set(0, 3, 0);
      node.getComponent(Rigidbody)!.rapierBody!.setTranslation({ x: 0, y: 3, z: 0 }, true);
      node.getComponent(Rigidbody)!.rapierBody!.setLinvel({ x: 0, y: 0, z: 0 }, true);
      run(2);
      expect(node.position.y).toBeCloseTo(1, 1);
      expect(ears.heard).toEqual(['collisionEnter:floor']);
      expect(() => (node.getComponent(SphereCollider)!.layer = 16)).toThrow(/0 to 15/);
    } finally {
      Physics.ignoreLayerCollision(0, 3, false);
    }
  });

  it("follows its node's scale, as Unity's colliders follow their transform", () => {
    const { scene, run } = world();
    const node = new Object3D();
    scene.add(node);
    node.addComponent(Rigidbody, { useGravity: false });
    const box = node.addComponent(BoxCollider, { size: new Vector3(1, 1, 1) });
    run(0.05);
    expect(box.rapierCollider!.halfExtents()!.x).toBeCloseTo(0.5);
    node.scale.set(4, 1, 2);
    run(1 / 60);
    const half = box.rapierCollider!.halfExtents()!;
    expect([half.x, half.y, half.z].map((v) => +v.toFixed(3))).toEqual([2, 0.5, 1]);
    expect(box.rapierCollider!.parent()).toBe(node.getComponent(Rigidbody)!.rapierBody); // the same collider, resized

    // Colliders on child nodes follow their parent's scale too: their size and where they sit.
    const parent = new Object3D();
    scene.add(parent);
    parent.addComponent(Rigidbody, { useGravity: false });
    const arm = new Object3D();
    arm.position.set(1, 0, 0);
    parent.add(arm);
    const ball = arm.addComponent(SphereCollider, { radius: 0.5 });
    const leg = new Object3D();
    leg.position.set(0, -1, 0);
    parent.add(leg);
    const capsule = leg.addComponent(CapsuleCollider, { radius: 0.25, height: 1 });
    run(0.05);
    const ballBefore = ball.rapierCollider!;
    parent.scale.setScalar(2);
    run(1 / 60);
    expect(ball.rapierCollider).toBe(ballBefore);
    expect(ball.rapierCollider!.radius()).toBeCloseTo(1, 3);
    expect(ball.rapierCollider!.translationWrtParent()!.x).toBeCloseTo(2, 3);
    expect(capsule.rapierCollider!.radius()).toBeCloseTo(0.5, 3);
    expect(capsule.rapierCollider!.halfHeight()).toBeCloseTo(0.5, 3); // a 2 m capsule: 1 m between caps
    expect(capsule.rapierCollider!.translationWrtParent()!.y).toBeCloseTo(-2, 3);
  });

  it('makes one body of the colliders on child nodes, as Unity compounds them', () => {
    const { scene, run } = world();
    floor(scene);
    const cart = new Object3D();
    cart.name = 'cart';
    cart.position.set(0, 4, 0);
    scene.add(cart);
    cart.addComponent(Rigidbody);
    const ears = cart.addComponent(Ears);
    // Two wheels under it, and no collider on the cart itself: they are its shape.
    const wheels = [-1, 1].map((x) => {
      const wheel = new Object3D();
      wheel.name = 'wheel';
      wheel.position.set(x, -0.5, 0);
      cart.add(wheel);
      return wheel.addComponent(SphereCollider, { radius: 0.5 });
    });
    run(2);
    expect(wheels.every((w) => w.attachedRigidbody?.node === cart && w.rapierCollider!.parent() !== null)).toBe(true);
    // It fell, and rests on its wheels: the floor's top is at 0.5, the wheels' centres 0.5 above it.
    expect(cart.position.y).toBeCloseTo(1.5, 1);
    expect(ears.heard).toContain('collisionEnter:floor');
    // A child moved within its body takes its collider along.
    const apart = () => new Vector3().copy(wheels[0]!.rapierCollider!.translation()).distanceTo(wheels[1]!.rapierCollider!.translation());
    expect(apart()).toBeCloseTo(2, 2);
    wheels[0]!.node.position.y = -1.5;
    run(1 / 60);
    expect(apart()).toBeCloseTo(Math.hypot(2, 1), 2);
  });

  it('holds a body that lands exactly on a peak, of a terrain or of a mesh', () => {
    const { scene, run } = world();
    // A cone of a hill, its top one sample, and a cone mesh beside it: each ball falls onto the tip.
    const n = 33;
    const heights = Float32Array.from({ length: n * n }, (_, i) => 3 * Math.max(0, 1 - Math.hypot(Math.floor(i / n) - 16, (i % n) - 16) / 16));
    const terrainData = { url: 'hill.terrain', isLoaded: true, heightmapResolution: n, size: new Vector3(20, 3, 20), heights, changed: new Event() };
    const hill = new Object3D();
    hill.addComponent(TerrainCollider, { terrainData });
    const cone = new Mesh(new ConeGeometry(6, 3, 24));
    cone.position.set(30, 1.5, 0);
    cone.addComponent(MeshCollider);
    scene.add(hill, cone);
    const balls = [0, 30].map((x) => {
      const node = new Object3D();
      node.position.set(x, 8, 0);
      scene.add(node);
      node.addComponent(Rigidbody);
      node.addComponent(SphereCollider, { radius: 0.5 });
      return node;
    });
    run(2);
    for (const ball of balls) expect(ball.position.y).toBeCloseTo(3.5, 1);
  });

  it('shapes a body with a convex mesh, rests it on a triangle mesh, and reports how hard it hit', () => {
    const { scene, run } = world();
    // The floor: two triangles, 20 m a side.
    const floor = new Object3D();
    floor.name = 'floor';
    const plane = new BufferGeometry();
    plane.setAttribute('position', new BufferAttribute(new Float32Array([-10, 0, -10, 10, 0, -10, 10, 0, 10, -10, 0, 10]), 3));
    plane.setIndex([0, 2, 1, 0, 3, 2]);
    floor.addComponent(MeshCollider, { sharedMesh: plane });
    scene.add(floor);
    // A box mesh as the body, its hull a 1 m cube, dropped from 5 m.
    const box = new Mesh(new BoxGeometry(1, 1, 1));
    box.position.set(0, 5, 0);
    box.addComponent(Rigidbody);
    box.addComponent(MeshCollider, { convex: true });
    const hits: number[] = [];
    class Feel extends Behaviour {
      override onCollisionEnter(c: Collision) { hits.push(c.impulse.length()); }
    }
    box.addComponent(Feel);
    scene.add(box);
    run(2);
    expect(box.position.y).toBeCloseTo(0.5, 1);
    // Mass 1 kg falling 4.5 m: about 9.4 m/s, so an impulse near 9 N·s stops it.
    expect(hits[0]).toBeGreaterThan(5);
    expect(hits[0]).toBeLessThan(15);
  });

  it("freezes the axes Unity's constraints name, and a change applies at once", () => {
    const { scene, run } = world();
    const b = ball(scene, 0);
    b.body.useGravity = false;
    b.body.constraints = RigidbodyConstraints.FreezePositionX | RigidbodyConstraints.FreezeRotationX | RigidbodyConstraints.FreezeRotationY;
    run(0.05);
    b.body.velocity = new Vector3(3, 2, 0);
    b.body.angularVelocity = new Vector3(4, 4, 4);
    run(0.5);
    expect(b.node.position.x).toBeCloseTo(0, 5); // frozen along x
    expect(b.node.position.y).toBeGreaterThan(0.5); // free along y
    const w = b.body.angularVelocity;
    expect([w.x, w.y]).toEqual([0, 0]);
    expect(w.z).toBeGreaterThan(1); // turns only about z
    expect(b.body.freezeRotation).toBe(false);
    b.body.freezeRotation = true; // Unity's shorthand: every rotation frozen, the position flag kept
    expect(b.body.constraints).toBe(RigidbodyConstraints.FreezePositionX | RigidbodyConstraints.FreezeRotation);
    run(0.05);
    expect(b.body.angularVelocity.z).toBe(0);
  });

  it('applies force modes the way Unity does', () => {
    const { scene, run } = world();
    const b = ball(scene, 0);
    b.body.useGravity = false;
    run(0.05); // colliders attach at start, which gives the body its mass
    b.body.velocity = new Vector3();
    b.body.addForce(new Vector3(2, 0, 0), ForceMode.VelocityChange);
    expect(b.body.velocity.x).toBeCloseTo(2);
    b.body.addForce(new Vector3(b.body.mass, 0, 0), ForceMode.Impulse);
    expect(b.body.velocity.x).toBeCloseTo(3);
    expect(() => {
      (b.body.velocity as Vector3).y = 5;
    }).toThrow(); // a copy: changing it would otherwise do nothing, silently
  });

  it('slides on a shared material by its combine mode, and a change to it reaches its colliders at once', () => {
    const { scene, run } = world();
    const ground = new Object3D();
    ground.scale.set(40, 1, 40);
    scene.add(ground);
    ground.addComponent(BoxCollider, { friction: 1 });
    const ice = new PhysicsMaterial({ friction: 0, frictionCombine: PhysicsMaterialCombine.Minimum });
    const box = (z: number, material: PhysicsMaterial | null) => {
      const node = new Object3D();
      node.position.set(0, 1, z);
      scene.add(node);
      const body = node.addComponent(Rigidbody);
      const collider = node.addComponent(BoxCollider, { friction: 1, material });
      return { node, body, collider };
    };
    const onIce = box(-3, ice);
    const plain = box(3, null);
    run(0.5); // settled on the ground
    for (const b of [onIce, plain]) b.body.velocity = new Vector3(4, 0, 0);
    run(1);
    // Minimum takes the ice's 0 over the ground's 1: it keeps going, where the plain box has stopped.
    expect(onIce.node.position.x).toBeGreaterThan(3.5);
    expect(plain.node.position.x).toBeLessThan(1.5);
    ice.friction = 0.7;
    expect(onIce.collider.rapierCollider!.friction()).toBeCloseTo(0.7);
  });
});

describe("Rapier's own API, for everything that is not a component or a message", () => {
  it('raycasts with world.castRay, and comes back to the object with colliderOf', () => {
    const { scene, run } = world();
    floor(scene);
    const eye = new Object3D();
    scene.add(eye);
    class Looker extends Behaviour {
      hitName = '';
      hitY = 0;
      override fixedUpdate() {
        const physics = service(this.node, Physics);
        const hit = physics.world.castRay(new RAPIER.Ray({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }), 100, true);
        if (!hit) return;
        this.hitName = physics.colliderOf(hit.collider)?.node.name ?? '';
        this.hitY = 5 - hit.timeOfImpact;
      }
    }
    const looker = eye.addComponent(Looker);
    run(0.1);
    expect(looker.hitName).toBe('floor');
    expect(looker.hitY).toBeCloseTo(0.5);
  });

  it('joins two bodies with world.createImpulseJoint, created in start when both exist', () => {
    const { scene, run } = world();
    const anchor = new Object3D();
    anchor.position.set(0, 5, 0);
    scene.add(anchor);
    anchor.addComponent(Rigidbody, { isKinematic: true });
    const weight = ball(scene, 3).node;

    class Rope extends Behaviour {
      to: Object3D | null = null;
      override start() {
        const a = this.getComponent(Rigidbody)!.rapierBody!;
        const b = this.to!.getComponent(Rigidbody)!.rapierBody!;
        const joint = RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, { x: 0, y: 2, z: 0 });
        service(this.node, Physics).world.createImpulseJoint(joint, a, b, true);
      }
    }
    anchor.addComponent(Rope, { to: weight });
    run(2);
    expect(weight.position.y).toBeCloseTo(3, 1); // hangs two metres below, instead of falling
  });

  it('drives a kinematic body with setNextKinematicTranslation, and the node follows', () => {
    const { scene, run } = world();
    const platform = new Object3D();
    scene.add(platform);
    platform.addComponent(Rigidbody, { isKinematic: true });
    platform.addComponent(BoxCollider);
    class Lift extends Behaviour {
      override fixedUpdate(dt: number) {
        const body = this.getComponent(Rigidbody)!.rapierBody!;
        const t = body.translation();
        body.setNextKinematicTranslation({ x: t.x, y: t.y + dt, z: t.z });
      }
    }
    platform.addComponent(Lift);
    run(1);
    expect(platform.position.y).toBeCloseTo(1, 1);
  });

  it("moves a character with Rapier's character controller, stopped by the floor", () => {
    const { scene, run } = world();
    floor(scene);
    const hero = new Object3D();
    hero.position.set(0, 2, 0);
    scene.add(hero);
    hero.addComponent(Rigidbody, { isKinematic: true });
    hero.addComponent(CapsuleCollider, { radius: 0.3, height: 1.8 });
    class Walker extends Behaviour {
      private controller: RAPIER.KinematicCharacterController | null = null;
      override start() {
        this.controller = service(this.node, Physics).world.createCharacterController(0.01);
      }
      override fixedUpdate(dt: number) {
        const collider = this.getComponent(CapsuleCollider)!.rapierCollider;
        if (!this.controller || !collider) return;
        this.controller.computeColliderMovement(collider, { x: dt, y: -5 * dt, z: 0 });
        const move = this.controller.computedMovement();
        const body = this.getComponent(Rigidbody)!.rapierBody!;
        const t = body.translation();
        body.setNextKinematicTranslation({ x: t.x + move.x, y: t.y + move.y, z: t.z + move.z });
      }
    }
    hero.addComponent(Walker);
    run(1);
    expect(hero.position.y).toBeCloseTo(1.4, 1); // capsule half-height 0.9 on a floor whose top is 0.5
    expect(hero.position.x).toBeGreaterThan(0.8);
  });

  it("answers Unity's queries: raycast, raycastAll, sphereCast, the overlaps, by layer and trigger", () => {
    const { scene, run } = world();
    floor(scene); // top at 0.5
    const box = (name: string, x: number, options: { layer?: number; isTrigger?: boolean } = {}) => {
      const node = new Object3D();
      node.name = name;
      node.position.set(x, 1, 0);
      scene.add(node);
      return node.addComponent(BoxCollider, options);
    };
    const near = box('near', 3);
    box('far', 6, { layer: 3 });
    box('zone', 9, { isTrigger: true });
    run(1 / 60);

    // Along +x from the left: the first box's face, at x 2.5.
    const hit = Physics.raycast(new Vector3(0, 1, 0), new Vector3(1, 0, 0))!;
    expect(hit.collider).toBe(near);
    expect(hit.distance).toBeCloseTo(2.5, 3);
    expect(hit.normal.toArray().map((v) => Math.round(v))).toEqual([-1, 0, 0]);
    expect(Physics.raycast(new Ray(new Vector3(0, 1, 0), new Vector3(1, 0, 0)), 2)).toBeNull(); // too short
    expect(Physics.raycast(new Vector3(0, 1, 0), new Vector3(1, 0, 0), Infinity, 1 << 3)!.node.name).toBe('far');
    expect(Physics.raycastAll(new Vector3(0, 1, 0), new Vector3(1, 0, 0)).map((h) => h.node.name)).toEqual(['near', 'far', 'zone']);
    expect(Physics.raycastAll(new Vector3(0, 1, 0), new Vector3(1, 0, 0), Infinity, Physics.AllLayers, QueryTriggerInteraction.Ignore).map((h) => h.node.name)).toEqual(['near', 'far']);
    // Straight down onto the floor.
    expect(Physics.raycast(new Vector3(0, 5, 0), new Vector3(0, -1, 0))!.point.y).toBeCloseTo(0.5, 3);

    // A ball of radius 0.4 swept along +x stops with its centre that far short of the face.
    const swept = Physics.sphereCast(new Vector3(0, 1, 0), 0.4, new Vector3(1, 0, 0))!;
    expect(swept.collider).toBe(near);
    expect(swept.distance).toBeCloseTo(2.1, 2);
    expect(swept.point.x).toBeCloseTo(2.5, 2);

    expect(Physics.overlapSphere(new Vector3(3, 1, 0), 1).map((c) => c.node.name).sort()).toEqual(['floor', 'near']);
    expect(Physics.overlapBox(new Vector3(6, 3, 0), new Vector3(1, 1, 1), new Quaternion())).toEqual([]);
    expect(Physics.checkSphere(new Vector3(9, 1, 0), 0.2)).toBe(true);
    expect(Physics.checkSphere(new Vector3(9, 1, 0), 0.2, Physics.AllLayers, QueryTriggerInteraction.Ignore)).toBe(false);
  });

  it('sends Stay while a contact lasts, with where it touches and which way', () => {
    const { scene, run } = world();
    floor(scene);
    const b = ball(scene, 1.2);
    const stays: Collision[] = [];
    class Feel extends Behaviour {
      override onCollisionStay(c: Collision) { stays.push(c); }
    }
    b.node.addComponent(Feel);
    run(2);
    expect(stays.length).toBeGreaterThan(10); // and then none: it fell asleep, as Unity's bodies do
    const last = stays.at(-1)!;
    expect(last.node.name).toBe('floor');
    const contact = last.getContact(0);
    expect(contact.normal.y).toBeCloseTo(1, 3); // out of the floor, towards the ball
    expect(contact.point.y).toBeCloseTo(0.5, 1);
    expect(contact.thisCollider.node).toBe(b.node);
    // Resting, the floor holds up about its weight each 1/50 s step — Rapier's soft contacts a little more.
    const weight = ((4 / 3) * Math.PI * 0.125 * 9.81) / 50;
    expect(last.impulse.y).toBeGreaterThan(weight * 0.9);
    expect(last.impulse.y).toBeLessThan(weight * 1.4);
  });

  it("walks a CharacterController as Unity's: stopped by walls, up steps it can take, and told what it hit", () => {
    const { scene, run, runtime } = world();
    floor(scene); // top at 0.5
    const block = (name: string, x: number, width: number, height: number) => {
      const node = new Object3D();
      node.name = name;
      node.position.set(x, 0.5 + height / 2, 0);
      node.scale.set(width, height, 4);
      scene.add(node);
      node.addComponent(BoxCollider);
    };
    block('step', 4.5, 3, 0.2); // from x 3 to 6, under stepOffset 0.3
    block('wall', 6.5, 1, 1.5); // its face at x 6
    const hero = new Object3D();
    hero.position.set(0, 2, 0);
    scene.add(hero);
    const controller = hero.addComponent(CharacterController);
    const hits: string[] = [];
    class Bumper extends Behaviour {
      override onControllerColliderHit(hit: ControllerColliderHit) { hits.push(hit.node.name); }
    }
    hero.addComponent(Bumper);
    class Walk extends Behaviour {
      override update() { controller.simpleMove(new Vector3(3, 0, 0)); }
    }
    hero.addComponent(Walk);
    run(0.5);
    expect(controller.isGrounded).toBe(true);
    expect(hero.position.y).toBeCloseTo(1.5 + controller.skinWidth, 1); // half its height above the floor
    run(3);
    expect(hero.position.y).toBeCloseTo(1.7 + controller.skinWidth, 1); // up on the step
    expect(hero.position.x).toBeCloseTo(6 - 0.5 - controller.skinWidth, 1); // against the wall
    expect(controller.collisionFlags & CollisionFlags.Sides).toBeTruthy();
    expect(hits).toContain('wall');
    // Put somewhere else by its node, it starts from there.
    hero.position.set(-5, 2, 0);
    runtime.update(1 / 60);
    expect(hero.position.x).toBeCloseTo(-5 + 3 / 60, 2);
  });

  it('joins bodies: a fixed pair falls as one, a hinge keeps its limits from where it started, a spring pulls back', () => {
    const { scene, run } = world();
    floor(scene);
    const body = (name: string, x: number, y: number) => {
      const node = new Object3D();
      node.name = name;
      node.position.set(x, y, 0);
      scene.add(node);
      node.addComponent(Rigidbody);
      node.addComponent(BoxCollider, { size: new Vector3(0.5, 0.5, 0.5) });
      return node;
    };
    // Fixed: a block glued beside another, held off the ground by nothing.
    const a = body('a', -10, 4);
    const b = body('b', -9, 4);
    b.addComponent(FixedJoint, { connectedBody: a.getComponent(Rigidbody) });
    // Hinge: a door already turned 40° about y, on a hinge in the world, ±30° from there, pushed open.
    const door = body('door', 10, 3);
    door.getComponent(Rigidbody)!.useGravity = false;
    door.rotation.y = (40 * Math.PI) / 180;
    door.addComponent(HingeJoint, { axis: new Vector3(0, 1, 0), useLimits: true, limits: { min: -30, max: 30 } });
    // Spring: a weight hung 1 m under a point in the world.
    const weight = body('weight', 20, 3);
    weight.addComponent(SpringJoint, { spring: 200, damper: 20 });
    run(0.1);
    door.getComponent(Rigidbody)!.angularVelocity = new Vector3(0, 5, 0);
    run(2);
    expect(b.position.x - a.position.x).toBeCloseTo(1, 2);
    expect(a.position.y).toBeLessThan(1); // fell, together
    expect((door.rotation.y * 180) / Math.PI).toBeCloseTo(70, 0); // 40° + its 30° limit
    door.getComponent(Rigidbody)!.angularVelocity = new Vector3(0, -5, 0);
    run(2);
    expect((door.rotation.y * 180) / Math.PI).toBeCloseTo(10, 0); // 40° − 30°
    expect(weight.position.y).toBeGreaterThan(2.7); // hangs near where it started, not on the floor
  });

  it('says so when a collider made with the raw API touches one of ours', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { scene, run } = world();
    const w = service(floor(scene).node, Physics).world;
    const raw = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 2, 0));
    w.createCollider(RAPIER.ColliderDesc.ball(0.5).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), raw);
    run(2);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/created with Rapier's API directly/);
    warn.mockRestore();
  });
});
