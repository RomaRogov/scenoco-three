import { Mesh, SphereGeometry } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { Engine } from '@scenoco-three/core';
import { bundleScene, compileSceneXml, loadComponents } from '@scenoco-three/compiler';
import { Collider, PhysicsSystem, RigidBody, initRapier } from '@scenoco-three/rapier';

// The Rapier WASM must be loaded before a World can be built.
beforeAll(async () => {
  await initRapier();
});

describe('rapier — imperative (engine.addComponent)', () => {
  it('a dynamic body falls under gravity and lands on a static body', () => {
    const engine = new Engine({ fixedTimeStep: 1 / 60 });
    engine.addSystem(new PhysicsSystem()); // default gravity (no <Physics> attachment)

    const ball = new Mesh(new SphereGeometry(0.5));
    ball.position.set(0, 5, 0);
    engine.scene.add(ball);
    engine.addComponent(ball, RigidBody); // dynamic by default
    engine.addComponent(ball, Collider); // shape="auto" → 0.5 ball from the geometry

    // half a second of free-fall: y goes from 5 toward ~3.8
    for (let i = 0; i < 30; i++) engine.tick(1 / 60);
    expect(ball.position.y).toBeLessThan(4.5);
    expect(ball.position.y).toBeGreaterThan(3);

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
        <Collider restitution="0" />
      </Components>
    </Mesh>
    <Mesh id="floor" position="0 0 0">
      <BoxGeometry width="20" height="0.2" depth="20" />
      <Components>
        <RigidBody kind="fixed" />
        <Collider />
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
      expect.arrayContaining(['RigidBody', 'Collider']),
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
    expect(scan.byName.get('Collider')).toBe('@scenoco-three/rapier');
    expect(scan.byTag.get('Physics')).toBe('@scenoco-three/rapier');
  });
});
