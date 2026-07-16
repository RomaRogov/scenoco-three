import { Mesh, SphereGeometry, type Object3D } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { Component, Engine, component } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';
import { BoxCollider2D, CircleCollider2D, Joint2DSystem, Physics2DSystem, RigidBody2D } from '@scenoco-three/box2d';
import { PhysicsSystem, RigidBody, SphereCollider, initRapier } from '@scenoco-three/rapier';

@component({ name: 'Contact2DRecorder', description: 'Counts 2D collision/trigger callbacks' })
class Contact2DRecorder extends Component {
  collisions = 0;
  triggers = 0;
  last?: Object3D;
  onCollisionEnter2D(other: Object3D): void { this.collisions++; this.last = other; }
  onTriggerEnter2D(other: Object3D): void { this.triggers++; this.last = other; }
}

describe('box2d (planck) — 2D physics', () => {
  it('a dynamic body falls under gravity and lands on a static floor, dispatching onCollisionEnter2D', () => {
    const engine = new Engine({ fixedTimeStep: 1 / 60 });
    engine.addSystem(new Physics2DSystem());

    const ball = new Mesh(new SphereGeometry(0.3));
    ball.position.set(0, 4, 0);
    engine.scene.add(ball);
    engine.addComponent(ball, RigidBody2D);
    engine.addComponent(ball, CircleCollider2D, { radius: 0.3 });
    const rec = engine.addComponent(ball, Contact2DRecorder);

    const floor = new Mesh();
    engine.scene.add(floor);
    engine.addComponent(floor, RigidBody2D, { kind: 'static' });
    engine.addComponent(floor, BoxCollider2D, { halfExtents: [10, 0.2] });

    for (let i = 0; i < 240; i++) engine.tick(1 / 60);
    expect(ball.position.y).toBeGreaterThan(0.3); // rests on the floor top (~0.5)
    expect(ball.position.y).toBeLessThan(1);
    expect(rec.collisions).toBeGreaterThan(0);
    expect(rec.last).toBe(floor);
    engine.dispose();
  });

  it('a sensor reports onTriggerEnter2D without stopping the body', () => {
    const engine = new Engine({ fixedTimeStep: 1 / 60 });
    engine.addSystem(new Physics2DSystem());

    const ball = new Mesh(new SphereGeometry(0.3));
    ball.position.set(0, 3, 0);
    engine.scene.add(ball);
    engine.addComponent(ball, RigidBody2D);
    engine.addComponent(ball, CircleCollider2D, { radius: 0.3 });

    const zone = new Mesh();
    engine.scene.add(zone);
    engine.addComponent(zone, RigidBody2D, { kind: 'static' });
    engine.addComponent(zone, BoxCollider2D, { halfExtents: [10, 0.2], isSensor: true });
    const rec = engine.addComponent(zone, Contact2DRecorder);

    for (let i = 0; i < 120; i++) engine.tick(1 / 60);
    expect(rec.triggers).toBeGreaterThan(0);
    expect(rec.collisions).toBe(0);
    expect(ball.position.y).toBeLessThan(-1); // passed through (no collision response)
    engine.dispose();
  });

  it('rb.enabled = false removes the body from simulation; re-enable resumes (Unity Rigidbody2D.simulated)', () => {
    const engine = new Engine({ fixedTimeStep: 1 / 60 });
    engine.addSystem(new Physics2DSystem());
    const ball = new Mesh(new SphereGeometry(0.3));
    ball.position.set(0, 4, 0);
    engine.scene.add(ball);
    const rb = engine.addComponent(ball, RigidBody2D);
    engine.addComponent(ball, CircleCollider2D, { radius: 0.3 });

    for (let i = 0; i < 30; i++) engine.tick(1 / 60);
    expect(ball.position.y).toBeLessThan(4); // falling

    rb.enabled = false;
    engine.tick(1 / 60); // reconcile deactivates the body
    const frozenY = ball.position.y;
    for (let i = 0; i < 30; i++) engine.tick(1 / 60);
    expect(ball.position.y).toBe(frozenY); // out of the simulation, node untouched

    rb.enabled = true;
    for (let i = 0; i < 30; i++) engine.tick(1 / 60);
    expect(ball.position.y).toBeLessThan(frozenY); // falling again from where it froze
    engine.dispose();
  });

  it('a Collider2D added after the body exists attaches its fixture; disabling it detaches', () => {
    const engine = new Engine({ fixedTimeStep: 1 / 60 });
    engine.addSystem(new Physics2DSystem());
    const ball = new Mesh(new SphereGeometry(0.3));
    ball.position.set(0, 2, 0);
    engine.scene.add(ball);
    engine.addComponent(ball, RigidBody2D, { bullet: true });
    const rec = engine.addComponent(ball, Contact2DRecorder);

    const floor = new Mesh();
    engine.scene.add(floor);
    engine.addComponent(floor, RigidBody2D, { kind: 'static' });
    engine.addComponent(floor, BoxCollider2D, { halfExtents: [10, 0.2] });

    engine.tick(1 / 60); // body created with no collider yet
    const collider = engine.addComponent(ball, CircleCollider2D, { radius: 0.3 });
    for (let i = 0; i < 240; i++) engine.tick(1 / 60);
    expect(rec.collisions).toBeGreaterThan(0); // the late-added fixture collides
    expect(ball.position.y).toBeGreaterThan(0); // resting on the floor, not fallen through

    collider.enabled = false;
    for (let i = 0; i < 120; i++) engine.tick(1 / 60);
    expect(ball.position.y).toBeLessThan(-1); // fixture detached → falls through
    engine.dispose();
  });

  it('a declarative <Physics2D> scene simulates on load and the system is scene-scoped', () => {
    const r = compileSceneXml(`<Scene>
      <Physics2D gravity="0 -9.81" />
      <Mesh id="ball" position="0 4 0"><SphereGeometry radius="0.3" /><Components><RigidBody2D bullet="true" /><CircleCollider2D radius="0.3" /></Components></Mesh>
      <Mesh id="floor" position="0 0 0"><BoxGeometry width="20" height="0.4" /><Components><RigidBody2D kind="static" /><BoxCollider2D halfExtents="10 0.2" /></Components></Mesh>
    </Scene>`);
    if (!r.ok) throw new Error('compile failed');
    const engine = new Engine({ fixedTimeStep: 1 / 60 });
    engine.loadScene(bundleScene(r.scene));
    expect(engine.getSystem(Physics2DSystem)).toBeDefined();
    const ball = engine.findObject('ball')!;
    for (let i = 0; i < 240; i++) engine.tick(1 / 60);
    expect(ball.position.y).toBeLessThan(1);
    engine.disposeScene();
    expect(engine.getSystem(Physics2DSystem)).toBeUndefined(); // scene-scoped
    engine.dispose();
  });

  it('a distance joint holds a body against gravity (Joint2DSystem is scene-scoped)', () => {
    const r = compileSceneXml(`<Scene>
      <Physics2D gravity="0 -9.81" />
      <Mesh id="anchor" position="0 5 0"><BoxGeometry /><Components><RigidBody2D kind="static" /><BoxCollider2D /></Components></Mesh>
      <Mesh id="bob" position="0 3 0"><SphereGeometry radius="0.5" /><Components>
        <RigidBody2D /><CircleCollider2D radius="0.5" /><Joint2D kind="distance" connectedBody="#anchor" anchor="0 0" connectedAnchor="0 0" />
      </Components></Mesh>
    </Scene>`);
    if (!r.ok) throw new Error('compile failed: ' + r.diagnostics.map((d) => d.message).join('; '));
    const engine = new Engine({ fixedTimeStep: 1 / 60 });
    engine.loadScene(bundleScene(r.scene));
    expect(engine.getSystem(Joint2DSystem)).toBeDefined();
    const bob = engine.findObject('bob')!;
    for (let i = 0; i < 240; i++) engine.tick(1 / 60);
    expect(bob.position.y).toBeGreaterThan(2.5); // pinned ~2 below the anchor, not free-falling
    engine.disposeScene();
    expect(engine.getSystem(Joint2DSystem)).toBeUndefined();
    engine.dispose();
  });
});

describe('rapier — 3D physics', () => {
  beforeAll(async () => {
    await initRapier(); // the Rapier WASM must load before a World can be built
  });

  it('auto-attaches the PhysicsSystem for a body added at runtime and enables CCD when ccd=true', () => {
    // CORE-IMPROVEMENTS #1 (auto-attach) + #4 (ccd): a spawn-only scene with no
    // bodies at load must start physics when the first RigidBody appears.
    const engine = new Engine({ fixedTimeStep: 1 / 60 });
    expect(engine.getSystem(PhysicsSystem)).toBeUndefined();

    const ball = new Mesh(new SphereGeometry(0.5));
    ball.position.set(0, 5, 0);
    engine.scene.add(ball);
    const rb = engine.addComponent(ball, RigidBody, { ccd: true });
    engine.addComponent(ball, SphereCollider, { radius: 0.5 });
    expect(engine.getSystem(PhysicsSystem)).toBeDefined(); // started, not silently dead

    engine.tick(1 / 60); // one fixed step builds the body
    expect(rb.body!.isCcdEnabled()).toBe(true);
    for (let i = 0; i < 30; i++) engine.tick(1 / 60);
    expect(ball.position.y).toBeLessThan(5); // it fell → physics is live
    engine.dispose();
  });

  it('a declarative <Physics> scene drops the ball onto the floor; the system is scene-scoped', () => {
    const r = compileSceneXml(`<Scene>
      <Physics gravity="0 -9.81 0" />
      <Mesh id="ball" position="0 5 0"><SphereGeometry radius="0.5" /><Components><RigidBody /><SphereCollider radius="0.5" restitution="0" /></Components></Mesh>
      <Mesh id="floor" position="0 0 0"><BoxGeometry width="20" height="0.2" depth="20" /><Components><RigidBody kind="fixed" /><BoxCollider halfExtents="10 0.1 10" /></Components></Mesh>
    </Scene>`);
    if (!r.ok) throw new Error('compile failed');
    const engine = new Engine({ fixedTimeStep: 1 / 60 });
    engine.loadScene(bundleScene(r.scene));
    expect(engine.getSystem(PhysicsSystem)).toBeDefined();
    const ball = engine.findObject('ball')!;
    for (let i = 0; i < 150; i++) engine.tick(1 / 60);
    expect(ball.position.y).toBeGreaterThan(0.4); // rests near y ≈ 0.6
    expect(ball.position.y).toBeLessThan(1);
    engine.disposeScene();
    expect(engine.getSystem(PhysicsSystem)).toBeUndefined();
    engine.dispose();
  });
});
