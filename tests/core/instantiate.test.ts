import { describe, expect, it } from 'vitest';
import { instantiateScene } from '@scenoco-three/core';
import { compileSceneXml } from '@scenoco-three/compiler';
import { Follow } from '../fixtures/components/Follow.js';
import { Oscillator } from '../fixtures/components/Oscillator.js';

function compile(xml: string) {
  const result = compileSceneXml(xml);
  if (!result.ok) throw new Error(`unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  return result.scene;
}

// A scene with a typed component-to-component reference (`Follow.source` → an
// `Oscillator`). The compiler resolves the `#osc` ref from XML-side id lookups,
// so `props.source` compiles to `{ component: <oscillator index> }`.
const REF_SCENE = `<Scene>
    <Group id="a"><Components><Oscillator id="osc" amplitude="1" /></Components></Group>
    <Group id="b"><Components><Follow source="#osc" /></Components></Group>
  </Scene>`;

describe('instantiateScene — reference wiring guard (P0-2 regression)', () => {
  it('resolves a valid typed component reference to the live instance', () => {
    const { components } = instantiateScene(compile(REF_SCENE));
    const follow = components.find((c) => c.instance instanceof Follow)!.instance as Follow;
    expect(follow.source).toBeInstanceOf(Oscillator);
  });

  // Reproduces the *runtime* end-state of the circular-import bug: the compiler
  // correctly emits a reference-shaped value (`{ component: N }`), but in a
  // bundled build the property's `@property({ type })` class captured `undefined`
  // when the decorator ran, so the registered meta type is no longer a reference
  // type. The old code silently `continue`d, leaving the raw `{ component: N }`
  // object in the field (surfacing as a cryptic crash deep in `update()`). We
  // simulate that mismatch by planting a reference-shaped value on a scalar prop.
  it('throws a diagnostic error when a reference-shaped value lands on a non-reference property', () => {
    const scene = compile(REF_SCENE);
    const follow = scene.components.find((c) => c.type === 'Follow')!;
    follow.props.scale = { component: 0 }; // `scale` is a Float, not a reference type
    expect(() => instantiateScene(scene)).toThrow(/reference-shaped compiled value/);
    expect(() => instantiateScene(scene)).toThrow(/circular import/);
  });

  it('throws when a reference-shaped value lands on an unregistered property', () => {
    const scene = compile(REF_SCENE);
    const follow = scene.components.find((c) => c.type === 'Follow')!;
    follow.props.notARealProp = { node: 0 };
    expect(() => instantiateScene(scene)).toThrow(/reference-shaped compiled value/);
  });
});

/**
 * The silent one: identical materials are interned to a single compiled entry, so
 * one live material serves every node that authored it. That is the right default
 * (it is what makes a wall of identical bricks cheap), but a component that
 * mutates `this.node.material` then mutates it for *all* of them — with `tsc`,
 * the validator, and each instance's own `@property` data all reporting fine.
 * Only the rendered picture disagrees, which is why both escape hatches exist.
 */
describe('shared attachments — per-instance materials', () => {
  const TWO_BRICKS = (unique: string) => `<Scene>
    <Mesh id="a"><Attachments><BoxGeometry /><MeshStandardMaterial color="#ffffff"${unique} /></Attachments></Mesh>
    <Mesh id="b"><Attachments><BoxGeometry /><MeshStandardMaterial color="#ffffff"${unique} /></Attachments></Mesh>
  </Scene>`;
  const meshes = (xml: string) => {
    const live = instantiateScene(compile(xml));
    const at = (id: string) => live.nodes.find((n) => n.sceneId === id) as unknown as { material: { color: { getHexString(): string; set(v: string): void } } };
    return { a: at('a'), b: at('b') };
  };

  it('shares one live material by default — recolouring one recolours the other', () => {
    const { a, b } = meshes(TWO_BRICKS(''));
    expect(a.material).toBe(b.material);
    a.material.color.set('#ff0000');
    expect(b.material.color.getHexString()).toBe('ff0000'); // the bug, in one line
  });

  it('gives each node its own material when the attachment declares unique', () => {
    const { a, b } = meshes(TWO_BRICKS(' unique="true"'));
    expect(a.material).not.toBe(b.material);
    a.material.color.set('#ff0000');
    expect(b.material.color.getHexString()).toBe('ffffff');
  });

  it('uniqueMaterial() detaches one node at runtime, idempotently', () => {
    const { a, b } = meshes(TWO_BRICKS(''));
    const node = a as unknown as import('three').Object3D;
    const mine = node.uniqueMaterial();
    expect(mine).toBe(node.uniqueMaterial()); // a second call must not orphan the first clone
    a.material.color.set('#ff0000');
    expect(b.material.color.getHexString()).toBe('ffffff');
  });

  it('says so, rather than silently doing nothing, on a node with no material', () => {
    const live = instantiateScene(compile(`<Scene><Group id="g" /></Scene>`));
    const group = live.nodes.find((n) => n.sceneId === 'g')!;
    expect(() => group.uniqueMaterial()).toThrow(/has no material/);
  });
});
