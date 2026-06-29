import { describe, expect, it } from 'vitest';
import { Engine } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';
import { Joint2DSystem } from '@scenoco-three/box2d';

const compile = (xml: string) => {
  const r = compileSceneXml(xml);
  if (!r.ok) throw new Error('compile failed: ' + r.diagnostics.map((d) => d.message).join('; '));
  return r.scene;
};

// A dynamic "bob" hangs from a static "anchor" by a rigid distance joint (2 units
// apart). Under gravity it must settle straight below the anchor (y≈3), not fall.
const jointScene = `<Scene>
  <Physics2D gravity="0 -9.81" />
  <Mesh id="anchor" position="0 5 0">
    <BoxGeometry /><Components><RigidBody2D kind="static" /><BoxCollider2D /></Components>
  </Mesh>
  <Mesh id="bob" position="0 3 0">
    <SphereGeometry radius="0.5" />
    <Components>
      <RigidBody2D />
      <CircleCollider2D radius="0.5" />
      <Joint2D kind="distance" connectedBody="#anchor" anchor="0 0" connectedAnchor="0 0" />
    </Components>
  </Mesh>
</Scene>`;

describe('box2d — joints', () => {
  it('compiles the <Joint2D> tag (registered via the package import)', () => {
    expect(compile(jointScene).components.map((c) => c.type)).toContain('Joint2D');
  });

  it('a distance joint holds a body against gravity (it does not fall away)', () => {
    const engine = new Engine({ fixedTimeStep: 1 / 60 });
    engine.loadScene(bundleScene(compile(jointScene)));
    expect(engine.getSystem(Joint2DSystem)).toBeDefined();

    const bob = engine.findObject('bob')!;
    for (let i = 0; i < 240; i++) engine.tick(1 / 60); // 4s

    // Pinned 2 units below the anchor (y≈3); free-fall would be far below 0.
    expect(bob.position.y).toBeGreaterThan(2.5);
    expect(bob.position.y).toBeLessThan(3.5);
    engine.dispose();
  });

  it('the Joint2DSystem is scene-scoped (removed on unload)', () => {
    const engine = new Engine();
    engine.loadScene(bundleScene(compile(jointScene)));
    expect(engine.getSystem(Joint2DSystem)).toBeDefined();
    engine.disposeScene();
    expect(engine.getSystem(Joint2DSystem)).toBeUndefined();
    engine.dispose();
  });
});
