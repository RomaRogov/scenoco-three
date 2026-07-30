import { describe, expect, it } from 'vitest';
import { Engine, type CompiledScene } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';
import { Oscillator } from '../fixtures/components/Oscillator.js';

/** A base scene the engine loads, so `spawnSubtree` has a real scene to graft onto. */
function loadedEngine(): Engine {
  const r = compileSceneXml('<Scene><Group id="base" /></Scene>');
  if (!r.ok) throw new Error('base scene failed to compile');
  const engine = new Engine({ editor: true });
  engine.loadScene(bundleScene(r.scene));
  return engine;
}

/** A standalone fragment: one id'd Group carrying an Oscillator component (root = index 0). */
function fragment(): CompiledScene {
  return {
    root: 0,
    nodes: [{
      tag: 'Group', parent: -1, children: [], id: 'pasted',
      transform: { position: [1, 2, 3], eulerAngles: [0, 0, 0], scale: [1, 1, 1], visible: true },
      attrs: {}, attachments: [], components: [0],
    }],
    attachments: [],
    components: [{ type: 'Oscillator', node: 0, props: { amplitude: 5 } }],
  };
}

describe('Engine.spawnSubtree — runtime plain-subtree spawn', () => {
  it('grafts a live, id-indexed, component-bearing subtree under the given parent', () => {
    const engine = loadedEngine();
    const parent = engine.findObject('base')!;

    const live = engine.spawnSubtree(fragment(), parent);

    // Added under the parent (plain node — not wrapped in a PrefabInstance).
    expect(parent.children).toContain(live.root);
    expect(live.root.type).toBe('Group');
    expect(live.root.position.toArray()).toEqual([1, 2, 3]);
    // Live index maps aligned to the fragment.
    expect(live.nodes[0]).toBe(live.root);
    expect(live.components[0]!.instance).toBeInstanceOf(Oscillator);
    // Indexed for findObject, and its component is registered + reachable.
    expect(engine.findObject('pasted')).toBe(live.root);
    expect(engine.getComponents(live.root)).toContain(live.components[0]!.instance);
    expect((live.components[0]!.instance as unknown as { amplitude: number }).amplitude).toBe(5);
  });

  it('inserts at an explicit index among the parent’s children', () => {
    const engine = loadedEngine();
    const parent = engine.scene;
    const before = parent.children.length;
    const live = engine.spawnSubtree(fragment(), parent, 0);
    expect(parent.children.indexOf(live.root)).toBe(0);
    expect(parent.children.length).toBe(before + 1);
  });

  it('destroy() removes the spawned subtree (detached + de-indexed after the tick flush)', () => {
    const engine = loadedEngine();
    const live = engine.spawnSubtree(fragment(), engine.scene);
    expect(engine.findObject('pasted')).toBeDefined();

    engine.destroy(live.root);
    engine.tick(0); // deferred teardown flushes at end of tick

    expect(engine.findObject('pasted')).toBeUndefined();
    expect(engine.scene.children).not.toContain(live.root);
  });
});
