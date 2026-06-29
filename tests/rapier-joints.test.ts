import { beforeAll, describe, expect, it } from 'vitest';
import { Engine } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';
import { JointSystem, initRapier } from '@scenoco-three/rapier';

beforeAll(async () => {
  await initRapier();
});

const compile = (xml: string) => {
  const r = compileSceneXml(xml);
  if (!r.ok) throw new Error('compile failed: ' + r.diagnostics.map((d) => d.message).join('; '));
  return r.scene;
};

// A dynamic "bob" hangs from a fixed "anchor" by a spherical joint. The joint
// pins bob's origin to a point 1 unit below the anchor's centre (world y≈4), so
// under gravity it should NOT free-fall — it stays near y=4.
const jointScene = `<Scene>
  <Physics gravity="0 -9.81 0" />
  <Mesh id="anchor" position="0 5 0">
    <BoxGeometry /><Components><RigidBody kind="fixed" /><BoxCollider /></Components>
  </Mesh>
  <Mesh id="bob" position="0 4 0">
    <SphereGeometry radius="0.5" />
    <Components>
      <RigidBody />
      <SphereCollider radius="0.5" />
      <Joint kind="spherical" connectedBody="#anchor" anchor="0 0 0" connectedAnchor="0 -1 0" />
    </Components>
  </Mesh>
</Scene>`;

describe('rapier — joints', () => {
  it('compiles the <Joint> tag (registered via the package import)', () => {
    const scene = compile(jointScene);
    expect(scene.components.map((c) => c.type)).toContain('Joint');
  });

  it('a spherical joint holds a body against gravity (it does not free-fall)', () => {
    const engine = new Engine({ fixedTimeStep: 1 / 60 });
    engine.loadScene(bundleScene(compile(jointScene)));
    expect(engine.getSystem(JointSystem)).toBeDefined();

    const bob = engine.findObject('bob')!;
    for (let i = 0; i < 180; i++) engine.tick(1 / 60); // 3s

    // Pinned ~1 below the anchor (y≈4); free-fall over 3s would be far below 0.
    expect(bob.position.y).toBeGreaterThan(3);
    expect(bob.position.y).toBeLessThan(5);
    engine.dispose();
  });

  it('the JointSystem is scene-scoped (removed on unload)', () => {
    const engine = new Engine();
    engine.loadScene(bundleScene(compile(jointScene)));
    expect(engine.getSystem(JointSystem)).toBeDefined();
    engine.disposeScene();
    expect(engine.getSystem(JointSystem)).toBeUndefined();
    engine.dispose();
  });
});
