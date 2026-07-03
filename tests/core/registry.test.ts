import { Color, Object3D, Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Component, Engine, Registry, component, property } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';
import { Oscillator } from '../fixtures/components/Oscillator.js';
import { Rotator } from '../fixtures/components/Rotator.js';

describe('@component / @property metadata', () => {
  @component({ name: 'TestSpinner', description: 'spins things in tests' })
  class TestSpinner extends Component {
    @property({ type: 'float', default: 2, description: 'spin rate' }) rate = 2;
    @property({ type: 'string', required: true, description: 'channel name' }) channel = '';
  }

  it('registers the class under its XML tag name and collects typed property metadata (incl. component refs)', () => {
    const entry = Registry.getComponent('TestSpinner')!;
    expect(entry.ctor).toBe(TestSpinner);
    expect(entry.meta.properties.get('rate')).toEqual({ type: 'float', default: 2, description: 'spin rate' });
    expect(entry.meta.properties.get('channel')).toEqual({ type: 'string', required: true, description: 'channel name' });

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

// Declares math defaults in every natural form; unset at runtime the fields must
// still become Three math types matching the compiled shape.
@component({ name: 'MathProbe', description: 'math default + coercion probe' })
class MathProbe extends Component {
  // Defaults declared as Vector3 / {x,y,z} / #hex (all normalize to the compiled
  // shape); the "wrong-shaped" field initializers must coerce to Three types.
  @property({ type: 'vec3', default: new Vector3(1, 2, 3), description: 'vec3 from Vector3' }) fromVector = [1, 2, 3];
  @property({ type: 'vec3', default: { x: 4, y: 5, z: 6 }, description: 'vec3 from {x,y,z}' }) fromObject = { x: 4, y: 5, z: 6 };
  @property({ type: 'vec2', default: [7, 8], description: 'vec2 from array' }) two = [7, 8];
  @property({ type: 'color', default: '#ff8800', description: 'color from #hex' }) tint = 0xff8800;
}

describe('@property math defaults normalize, and coerce to Three types at runtime', () => {
  it('accepts Vector3 / {x,y,z} / array / #hex as defaults and delivers Three types to the live component', () => {
    const props = Registry.getComponent('MathProbe')!.meta.properties;
    expect(props.get('fromVector')!.default).toEqual([1, 2, 3]);
    expect(props.get('fromObject')!.default).toEqual([4, 5, 6]);
    expect(props.get('tint')!.default).toBe(0xff8800);

    const r = compileSceneXml('<Scene><Group id="g"><Components><MathProbe /></Components></Group></Scene>');
    if (!r.ok) throw new Error('compile failed');
    const engine = new Engine();
    engine.loadScene(bundleScene(r.scene));
    const c = engine.findComponent('g', MathProbe)! as unknown as Record<string, unknown>;
    expect((c.fromVector as Vector3).toArray()).toEqual([1, 2, 3]);
    expect((c.fromObject as Vector3).toArray()).toEqual([4, 5, 6]);
    expect((c.two as Vector2).toArray()).toEqual([7, 8]);
    expect((c.tint as Color).getHex()).toBe(0xff8800);
    engine.dispose();
  });
});
