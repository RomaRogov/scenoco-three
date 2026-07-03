import { Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Component, Engine } from '@scenoco-three/core';
import { compileSceneXml } from '@scenoco-three/compiler';
import '@scenoco-three/core/nodes';
import { BoxCollider, CollisionSystem, PlaneCollider, SphereCollider } from '@scenoco-three/collision';

/** Records the rapier-shaped contact hooks dispatched to its node. */
class Recorder extends Component {
  collisions: Object3D[] = [];
  colExits: Object3D[] = [];
  triggers: Object3D[] = [];
  onCollisionEnter(o: Object3D): void { this.collisions.push(o); }
  onCollisionExit(o: Object3D): void { this.colExits.push(o); }
  onTriggerEnter(o: Object3D): void { this.triggers.push(o); }
}

function makeBox(engine: Engine, pos: [number, number, number], half = 1, opts: Partial<BoxCollider> = {}) {
  const node = new Object3D();
  node.position.set(...pos);
  engine.scene.add(node);
  engine.addComponent(node, BoxCollider, { halfExtents: new Vector3(half, half, half), ...opts });
  const rec = engine.addComponent(node, Recorder);
  return { node, rec };
}

describe('@scenoco-three/collision — CollisionSystem (rapier-aligned)', () => {
  it('auto-attaches and fires onCollisionEnter once then onCollisionExit for solid colliders', () => {
    const engine = new Engine();
    expect(engine.getSystem(CollisionSystem)).toBeUndefined();
    const a = makeBox(engine, [0, 0, 0]);
    const b = makeBox(engine, [1.5, 0, 0]); // |dx|=1.5 ≤ 2 → overlap
    expect(engine.getSystem(CollisionSystem)).toBeDefined();

    engine.tick(1 / 60);
    expect(a.rec.collisions).toEqual([b.node]);
    engine.tick(1 / 60);
    expect(a.rec.collisions).toHaveLength(1); // no duplicate enter

    b.node.position.set(3, 0, 0);
    engine.tick(1 / 60);
    expect(a.rec.colExits).toEqual([b.node]);
    engine.dispose();
  });

  it('fires onTriggerEnter (not collision) when either collider is a sensor', () => {
    const engine = new Engine();
    const a = makeBox(engine, [0, 0, 0], 1, { isSensor: true });
    const b = makeBox(engine, [1.5, 0, 0]);
    engine.tick(1 / 60);
    expect(a.rec.triggers).toEqual([b.node]);
    expect(b.rec.triggers).toEqual([a.node]); // sensor on either side → trigger for both
    expect(a.rec.collisions).toEqual([]);
    engine.dispose();
  });

  it('detects a PlaneCollider (thin box) crossed by a sphere, and its exit', () => {
    const engine = new Engine();
    const plane = new Object3D();
    engine.scene.add(plane);
    engine.addComponent(plane, PlaneCollider);
    const rp = engine.addComponent(plane, Recorder);
    const ball = new Object3D();
    ball.position.set(0, 0.4, 0); // r=0.5 reaches down to −0.1 → crosses the plane
    engine.scene.add(ball);
    engine.addComponent(ball, SphereCollider, { radius: 0.5 });
    engine.addComponent(ball, Recorder);
    engine.tick(1 / 60);
    expect(rp.collisions).toEqual([ball]);
    ball.position.set(0, 2, 0);
    engine.tick(1 / 60);
    expect(rp.colExits).toEqual([ball]);
    engine.dispose();
  });

  it('accepts a rapier-shaped scene (<Physics>/<RigidBody>/<*Collider>) as a drop-in', () => {
    const r = compileSceneXml(`<Scene>
      <Physics gravity="0 -9.81 0" />
      <Mesh><BoxGeometry /><Components><RigidBody kind="dynamic" /><BoxCollider halfExtents="1 1 1" isSensor="true" /></Components></Mesh>
    </Scene>`);
    expect(r.ok).toBe(true); // the same XML rapier authors validates under collision too
  });
});
