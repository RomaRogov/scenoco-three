import { Mesh, SphereGeometry, type Object3D } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { Component, component, Engine } from '@scenoco-three/core';
import { bundleScene, compileSceneXml, loadComponents } from '@scenoco-three/compiler';
import { BoxCollider, PhysicsSystem, RigidBody, SphereCollider, initRapier } from '@scenoco-three/rapier';

// The Rapier WASM must be loaded before a World can be built.
beforeAll(async () => {
  await initRapier();
});

// Records the 3D contact hooks the PhysicsSystem dispatches.
@component({ name: 'ContactRecorder', description: 'Counts 3D collision/trigger callbacks' })
class ContactRecorder extends Component {
  collisions = 0;
  triggers = 0;
  exits = 0;
  last?: Object3D;
  onCollisionEnter(other: Object3D): void { this.collisions++; this.last = other; }
  onCollisionExit(): void { this.exits++; }
  onTriggerEnter(other: Object3D): void { this.triggers++; this.last = other; }
}

describe('rapier — imperative (engine.addComponent)', () => {
  it('a dynamic body falls under gravity and lands on a static body', () => {
    const engine = new Engine({ fixedTimeStep: 1 / 60 });
    engine.addSystem(new PhysicsSystem()); // default gravity (no <Physics> attachment)

    const ball = new Mesh(new SphereGeometry(0.5));
    ball.position.set(0, 5, 0);
    engine.scene.add(ball);
    engine.addComponent(ball, RigidBody); // dynamic by default
    engine.addComponent(ball, SphereCollider, { radius: 0.5 });

    // half a second of free-fall: y goes from 5 toward ~3.8
    for (let i = 0; i < 30; i++) engine.tick(1 / 60);
    expect(ball.position.y).toBeLessThan(4.5);
    expect(ball.position.y).toBeGreaterThan(3);

    engine.dispose();
  });

  it('dispatches onCollisionEnter when a falling body hits a static body', () => {
    const engine = new Engine({ fixedTimeStep: 1 / 60 });
    engine.addSystem(new PhysicsSystem());

    const ball = new Mesh(new SphereGeometry(0.5));
    ball.position.set(0, 3, 0);
    engine.scene.add(ball);
    engine.addComponent(ball, RigidBody);
    engine.addComponent(ball, SphereCollider, { radius: 0.5 });
    const rec = engine.addComponent(ball, ContactRecorder);

    const floor = new Mesh();
    engine.scene.add(floor);
    engine.addComponent(floor, RigidBody, { kind: 'fixed' });
    engine.addComponent(floor, BoxCollider, { halfExtents: [10, 0.5, 10] });

    for (let i = 0; i < 240; i++) engine.tick(1 / 60); // 4s — fall + settle
    expect(rec.collisions).toBeGreaterThan(0);
    expect(rec.triggers).toBe(0);
    expect(rec.last).toBe(floor);

    engine.dispose();
  });

  it('a sensor collider reports onTriggerEnter without stopping the body', () => {
    const engine = new Engine({ fixedTimeStep: 1 / 60 });
    engine.addSystem(new PhysicsSystem());

    const ball = new Mesh(new SphereGeometry(0.5));
    ball.position.set(0, 3, 0);
    engine.scene.add(ball);
    engine.addComponent(ball, RigidBody);
    engine.addComponent(ball, SphereCollider, { radius: 0.5 });

    const zone = new Mesh();
    zone.position.set(0, 0, 0);
    engine.scene.add(zone);
    engine.addComponent(zone, RigidBody, { kind: 'fixed' });
    engine.addComponent(zone, BoxCollider, { halfExtents: [10, 0.5, 10], isSensor: true });
    const rec = engine.addComponent(zone, ContactRecorder);

    for (let i = 0; i < 120; i++) engine.tick(1 / 60); // 2s
    expect(rec.triggers).toBeGreaterThan(0);
    expect(rec.collisions).toBe(0);
    expect(ball.position.y).toBeLessThan(-1); // passed through (no collision response)

    engine.dispose();
  });
});

describe('rapier — declarative scene', () => {
  const xml = `<Scene>
    <Physics gravity="0 -9.81 0" />
    <Mesh id="ball" position="0 5 0">
      <SphereGeometry radius="0.5" />
      <Components>
        <RigidBody />
        <SphereCollider radius="0.5" restitution="0" />
      </Components>
    </Mesh>
    <Mesh id="floor" position="0 0 0">
      <BoxGeometry width="20" height="0.2" depth="20" />
      <Components>
        <RigidBody kind="fixed" />
        <BoxCollider halfExtents="10 0.1 10" />
      </Components>
    </Mesh>
  </Scene>`;

  it('compiles the physics tags (registered via the package import)', () => {
    const result = compileSceneXml(xml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // <Physics> compiled as a scene attachment; bodies/colliders as components.
    expect(result.scene.attachments.map((a) => a.tag)).toContain('Physics');
    expect(result.scene.components.map((c) => c.type)).toEqual(
      expect.arrayContaining(['RigidBody', 'SphereCollider', 'BoxCollider']),
    );
  });

  it('simulates on load: the ball drops onto the floor', () => {
    const result = compileSceneXml(xml);
    if (!result.ok) throw new Error('compile failed');
    const engine = new Engine({ fixedTimeStep: 1 / 60 });
    engine.loadScene(bundleScene(result.scene));
    expect(engine.getSystem(PhysicsSystem)).toBeDefined();

    const ball = engine.findObject('ball')!;
    for (let i = 0; i < 150; i++) engine.tick(1 / 60); // 2.5s — fall + settle

    // floor top = 0.1, ball radius 0.5 → rests near y ≈ 0.6
    expect(ball.position.y).toBeLessThan(1);
    expect(ball.position.y).toBeGreaterThan(0.4);

    engine.dispose();
  });

  it('the <Physics> system is scene-scoped (removed on unload)', () => {
    const result = compileSceneXml(xml);
    if (!result.ok) throw new Error('compile failed');
    const engine = new Engine();
    engine.loadScene(bundleScene(result.scene));
    expect(engine.getSystem(PhysicsSystem)).toBeDefined();
    engine.disposeScene();
    expect(engine.getSystem(PhysicsSystem)).toBeUndefined();
    engine.dispose();
  });
});

describe('rapier — usage-based shipping', () => {
  it('loadComponents registers the package tags and maps them to the package', async () => {
    const scan = await loadComponents([], process.cwd(), { packages: ['@scenoco-three/rapier'] });
    // Components resolve via byName, the setting (a node tag) via byTag.
    expect(scan.byName.get('RigidBody')).toBe('@scenoco-three/rapier');
    expect(scan.byName.get('BoxCollider')).toBe('@scenoco-three/rapier');
    expect(scan.byName.get('SphereCollider')).toBe('@scenoco-three/rapier');
    expect(scan.byTag.get('Physics')).toBe('@scenoco-three/rapier');
  });
});
