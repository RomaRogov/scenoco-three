import { Color, Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Component, Engine, component, property } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';

// Author wrote the "wrong"-shaped field initializers (array / object / number)
// for math props. Unset at runtime, they must still become Three math types.
@component({ name: 'CoerceProbe', description: 'coercion probe' })
class CoerceProbe extends Component {
  @property({ type: 'vec3', default: [1, 2, 3], description: 'via array' }) viaArray = [1, 2, 3];
  @property({ type: 'vec3', default: [4, 5, 6], description: 'via object' }) viaObject = { x: 4, y: 5, z: 6 };
  @property({ type: 'vec2', default: [7, 8], description: 'vec2' }) two = [7, 8];
  @property({ type: 'color', default: 0xff8800, description: 'color' }) tint = 0xff8800;
  // The canonical form already — must stay identical (idempotent).
  @property({ type: 'vec3', default: [0, 1, 0], description: 'canonical' }) canonical = new Vector3(0, 1, 0);
}

describe('runtime math props are consistent whether set or unset', () => {
  it('coerces unset vec/color fields to Three types regardless of initializer shape', () => {
    const r = compileSceneXml('<Scene><Group id="g"><Components><CoerceProbe /></Components></Group></Scene>');
    if (!r.ok) throw new Error('compile failed');
    const engine = new Engine();
    engine.loadScene(bundleScene(r.scene));
    const c = engine.findComponent('g', CoerceProbe)! as unknown as Record<string, unknown>;

    expect(c.viaArray).toBeInstanceOf(Vector3);
    expect((c.viaArray as Vector3).toArray()).toEqual([1, 2, 3]);
    expect(c.viaObject).toBeInstanceOf(Vector3);
    expect((c.viaObject as Vector3).toArray()).toEqual([4, 5, 6]);
    expect(c.two).toBeInstanceOf(Vector2);
    expect((c.two as Vector2).toArray()).toEqual([7, 8]);
    expect(c.tint).toBeInstanceOf(Color);
    expect((c.tint as Color).getHex()).toBe(0xff8800);
    expect(c.canonical).toBeInstanceOf(Vector3);
    engine.dispose();
  });

  it('a SET value and an UNSET value end up the same type', () => {
    const r = compileSceneXml('<Scene><Group id="g"><Components><CoerceProbe viaArray="9 9 9" /></Components></Group></Scene>');
    if (!r.ok) throw new Error('compile failed');
    const engine = new Engine();
    engine.loadScene(bundleScene(r.scene));
    const c = engine.findComponent('g', CoerceProbe)! as unknown as Record<string, unknown>;
    expect(c.viaArray).toBeInstanceOf(Vector3); // set → Vector3
    expect(c.viaObject).toBeInstanceOf(Vector3); // unset → Vector3 too
    engine.dispose();
  });
});
