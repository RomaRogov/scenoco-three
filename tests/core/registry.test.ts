import { Color, Object3D, Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Component, Engine, Registry, component, property, ValueType } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';
import { Oscillator } from '../fixtures/components/Oscillator.js';
import { Rotator } from '../fixtures/components/Rotator.js';

describe('@component / @property metadata', () => {
  @component({ name: 'TestSpinner', description: 'spins things in tests' })
  class TestSpinner extends Component {
    @property({ type: ValueType.Float, description: 'spin rate' }) rate = 2;
    @property({ type: ValueType.String, required: true, description: 'channel name' }) channel = '';
  }

  it('registers the class under its XML tag name and collects typed property metadata (incl. component refs)', () => {
    const entry = Registry.getComponent('TestSpinner')!;
    expect(entry.ctor).toBe(TestSpinner);
    expect(entry.meta.properties.get('rate')).toEqual({ type: ValueType.Float, default: 2, description: 'spin rate' });
    expect(entry.meta.properties.get('channel')).toEqual({
      type: ValueType.String,
      default: '',
      required: true,
      description: 'channel name',
    });

    @component({ name: 'TestFollower', description: 'follows a spinner' })
    class TestFollower extends Component {
      @property({ type: TestSpinner, description: 'the spinner to follow' }) target: TestSpinner | null = null;
    }
    void TestFollower;
    expect(Registry.getComponent('TestFollower')!.meta.properties.get('target')).toEqual({
      type: TestSpinner,
      description: 'the spinner to follow',
    });
  });
});

describe('built-in component behaviour', () => {
  it('Rotator spins and Oscillator moves around its captured origin, exposing its offset', () => {
    const engine = new Engine();
    const spinner = new Object3D();
    engine.addComponent(spinner, Rotator, { speed: Math.PI });
    engine.tick(1);
    expect(spinner.rotation.y).toBeCloseTo(Math.PI);

    const bob = new Object3D();
    bob.position.set(0, 5, 0);
    const osc = engine.addComponent(bob, Oscillator, { axis: new Vector3(0, 1, 0), amplitude: 2, frequency: 1 });
    engine.tick(0.25); // quarter period: sin(2π·0.25)=1 → offset = amplitude
    expect(bob.position.y).toBeCloseTo(7);
    expect(osc.offset).toBeCloseTo(2);
    engine.dispose();
  });
});

// Field initializers in every natural shape a math/color property accepts; the
// compiled default is derived from each one, and at runtime the field must
// still become a Three math type matching that compiled shape.
@component({ name: 'MathProbe', description: 'math default derivation + coercion probe' })
class MathProbe extends Component {
  @property({ type: ValueType.Vec3, description: 'vec3 from a real Vector3' }) fromVector = new Vector3(1, 2, 3);
  @property({ type: ValueType.Vec3, description: 'vec3 from {x,y,z}' }) fromObject = { x: 4, y: 5, z: 6 };
  @property({ type: ValueType.Vec2, description: 'vec2 from array' }) two = [7, 8];
  @property({ type: ValueType.Color, description: 'color from a number' }) tint = 0xff8800;
  @property({ type: ValueType.Color, description: 'color from a #hex string' }) tintHex = '#ff8800';
}

describe('@property defaults derive from field initializers in every natural shape', () => {
  it('normalizes Vector3 / {x,y,z} / array / number / #hex initializers and delivers Three types to the live component', () => {
    const props = Registry.getComponent('MathProbe')!.meta.properties;
    expect(props.get('fromVector')!.default).toEqual([1, 2, 3]);
    expect(props.get('fromObject')!.default).toEqual([4, 5, 6]);
    expect(props.get('two')!.default).toEqual([7, 8]);
    expect(props.get('tint')!.default).toBe(0xff8800);
    expect(props.get('tintHex')!.default).toBe(0xff8800);

    const r = compileSceneXml('<Scene><Group id="g"><Components><MathProbe /></Components></Group></Scene>');
    if (!r.ok) throw new Error('compile failed');
    const engine = new Engine();
    engine.loadScene(bundleScene(r.scene));
    const c = engine.findComponent('g', MathProbe)! as unknown as Record<string, unknown>;
    expect((c.fromVector as Vector3).toArray()).toEqual([1, 2, 3]);
    expect((c.fromObject as Vector3).toArray()).toEqual([4, 5, 6]);
    expect((c.two as Vector2).toArray()).toEqual([7, 8]);
    expect((c.tint as Color).getHex()).toBe(0xff8800);
    expect((c.tintHex as Color).getHex()).toBe(0xff8800);
    engine.dispose();
  });
});
