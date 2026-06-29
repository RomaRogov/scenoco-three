import { Euler, Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Component, Registry, component, property } from '@scenoco-three/core';

// A component declaring vec/color defaults in every natural form — all must
// normalize to the compiled shape (number arrays / 0xRRGGBB numbers).
@component({ name: 'DefaultsProbe', description: 'default-normalization probe' })
class DefaultsProbe extends Component {
  @property({ type: 'vec3', default: new Vector3(1, 2, 3), description: 'vec3 from Vector3' }) a = new Vector3();
  @property({ type: 'vec3', default: { x: 4, y: 5, z: 6 }, description: 'vec3 from {x,y,z}' }) b = new Vector3();
  @property({ type: 'vec3', default: [7, 8, 9], description: 'vec3 from array' }) c = new Vector3();
  @property({ type: 'vec2', default: new Vector2(1, 2), description: 'vec2 from Vector2' }) d = new Vector2();
  @property({ type: 'vec2', default: { x: 3, y: 4 }, description: 'vec2 from {x,y}' }) e = new Vector2();
  @property({ type: 'euler', default: new Euler(0.1, 0.2, 0.3), description: 'euler from Euler' }) f = new Euler();
  @property({ type: 'color', default: '#ff8800', description: 'color from #hex' }) g = 0xff8800;
  @property({ type: 'color', default: 0x00ff00, description: 'color from number' }) h = 0x00ff00;
}

describe('@property default normalization (forgiving, consistent forms)', () => {
  const props = Registry.getComponent('DefaultsProbe')!.meta.properties;
  const def = (k: string) => props.get(k)!.default;

  it('vec3 accepts Vector3 / {x,y,z} / array, all → number array', () => {
    expect(def('a')).toEqual([1, 2, 3]);
    expect(def('b')).toEqual([4, 5, 6]);
    expect(def('c')).toEqual([7, 8, 9]);
  });

  it('vec2 accepts Vector2 / {x,y}', () => {
    expect(def('d')).toEqual([1, 2]);
    expect(def('e')).toEqual([3, 4]);
  });

  it('euler accepts a THREE.Euler', () => {
    expect(def('f')).toEqual([0.1, 0.2, 0.3]);
  });

  it('color accepts "#rrggbb" string or number, both → 0xRRGGBB number', () => {
    expect(def('g')).toBe(0xff8800);
    expect(def('h')).toBe(0x00ff00);
  });
});
