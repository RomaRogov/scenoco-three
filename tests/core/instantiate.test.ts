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
