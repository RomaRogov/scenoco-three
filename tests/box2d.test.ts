import { Mesh, SphereGeometry, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { Component, component, Engine } from '@scenoco-three/core';
import { bundleScene, compileSceneXml, loadComponents } from '@scenoco-three/compiler';
import { Collider2D, Physics2DSystem, RigidBody2D } from '@scenoco-three/box2d';

// Records the 2D contact hooks the Physics2DSystem dispatches.
@component({ name: 'Contact2DRecorder', description: 'Counts 2D collision/trigger callbacks' })
class Contact2DRecorder extends Component {
  collisions = 0;
  triggers = 0;
  last?: Object3D;
  onCollisionEnter2D(other: Object3D): void { this.collisions++; this.last = other; }
  onTriggerEnter2D(other: Object3D): void { this.triggers++; this.last = other; }
}

describe('box2d — imperative (engine.addComponent)', () => {
  it('a dynamic body falls under gravity and lands on a static floor', () => {
    const engine = new Engine({ fixedTimeStep: 1 / 60 });
    engine.addSystem(new Physics2DSystem()); // default gravity (no <Physics2D> attachment)

    const ball = new Mesh(new SphereGeometry(0.3));
    ball.position.set(0, 4, 0);
    engine.scene.add(ball);
    engine.addComponent(ball, RigidBody2D); // dynamic
    engine.addComponent(ball, Collider2D); // shape="auto" → 0.3 circle

    const floor = new Mesh();
    floor.position.set(0, 0, 0);
    engine.scene.add(floor);
    engine.addComponent(floor, RigidBody2D, { kind: 'static' });
    engine.addComponent(floor, Collider2D, { shape: 'box', halfExtents: [10, 0.2] });

    for (let i = 0; i < 240; i++) engine.tick(1 / 60); // 4s — fall + settle
    // floor top = 0.2, ball radius 0.3 → rests near y ≈ 0.5
    expect(ball.position.y).toBeLessThan(1);
    expect(ball.position.y).toBeGreaterThan(0.3);

    engine.dispose();
  });

  it('dispatches onCollisionEnter2D when two solid bodies touch', () => {
    const engine = new Engine({ fixedTimeStep: 1 / 60 });
    engine.addSystem(new Physics2DSystem());

    const ball = new Mesh(new SphereGeometry(0.3));
    ball.position.set(0, 3, 0);
    engine.scene.add(ball);
    engine.addComponent(ball, RigidBody2D);
    engine.addComponent(ball, Collider2D);
    const rec = engine.addComponent(ball, Contact2DRecorder);

    const floor = new Mesh();
    engine.scene.add(floor);
    engine.addComponent(floor, RigidBody2D, { kind: 'static' });
    engine.addComponent(floor, Collider2D, { shape: 'box', halfExtents: [10, 0.2] });

    for (let i = 0; i < 240; i++) engine.tick(1 / 60);
    expect(rec.collisions).toBeGreaterThan(0);
    expect(rec.triggers).toBe(0);
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
    engine.addComponent(ball, Collider2D);

    const zone = new Mesh();
    zone.position.set(0, 0, 0);
    engine.scene.add(zone);
    engine.addComponent(zone, RigidBody2D, { kind: 'static' });
    engine.addComponent(zone, Collider2D, { shape: 'box', halfExtents: [10, 0.2], isSensor: true });
    const rec = engine.addComponent(zone, Contact2DRecorder);

    for (let i = 0; i < 120; i++) engine.tick(1 / 60); // 2s
    expect(rec.triggers).toBeGreaterThan(0);
    expect(rec.collisions).toBe(0);
    expect(ball.position.y).toBeLessThan(-1); // passed through (no collision response)

    engine.dispose();
  });
});

describe('box2d — declarative scene', () => {
  const xml = `<Scene>
    <Physics2D gravity="0 -9.81" />
    <Mesh id="ball" position="0 4 0">
      <SphereGeometry radius="0.3" />
      <Components>
        <RigidBody2D bullet="true" />
        <Collider2D restitution="0" />
      </Components>
    </Mesh>
    <Mesh id="floor" position="0 0 0">
      <BoxGeometry width="20" height="0.4" depth="1" />
      <Components>
        <RigidBody2D kind="static" />
        <Collider2D />
      </Components>
    </Mesh>
  </Scene>`;

  it('compiles the 2D physics tags (registered via the package import)', () => {
    const result = compileSceneXml(xml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.attachments.map((a) => a.tag)).toContain('Physics2D');
    expect(result.scene.components.map((c) => c.type)).toEqual(
      expect.arrayContaining(['RigidBody2D', 'Collider2D']),
    );
  });

  it('simulates on load: the ball drops onto the floor', () => {
    const result = compileSceneXml(xml);
    if (!result.ok) throw new Error('compile failed');
    const engine = new Engine({ fixedTimeStep: 1 / 60 });
    engine.loadScene(bundleScene(result.scene));
    expect(engine.getSystem(Physics2DSystem)).toBeDefined();

    const ball = engine.findObject('ball')!;
    for (let i = 0; i < 240; i++) engine.tick(1 / 60);
    // floor top = 0.2, ball radius 0.3 → rests near y ≈ 0.5
    expect(ball.position.y).toBeLessThan(1);
    expect(ball.position.y).toBeGreaterThan(0.3);

    engine.dispose();
  });

  it('the <Physics2D> system is scene-scoped (removed on unload)', () => {
    const result = compileSceneXml(xml);
    if (!result.ok) throw new Error('compile failed');
    const engine = new Engine();
    engine.loadScene(bundleScene(result.scene));
    expect(engine.getSystem(Physics2DSystem)).toBeDefined();
    engine.disposeScene();
    expect(engine.getSystem(Physics2DSystem)).toBeUndefined();
    engine.dispose();
  });
});

describe('box2d — usage-based shipping', () => {
  it('loadComponents registers the package tags and maps them to the package', async () => {
    const scan = await loadComponents([], process.cwd(), { packages: ['@scenoco-three/box2d'] });
    expect(scan.byName.get('RigidBody2D')).toBe('@scenoco-three/box2d');
    expect(scan.byName.get('Collider2D')).toBe('@scenoco-three/box2d');
    expect(scan.byTag.get('Physics2D')).toBe('@scenoco-three/box2d');
  });
});
