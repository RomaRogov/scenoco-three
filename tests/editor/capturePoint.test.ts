import { describe, expect, it } from 'vitest';
import { capturePoint } from '../../packages/editor/app/session.js';

/**
 * `camera`/`lookAt` on a capture are points in the scene, so they are written the
 * way points are written in the scene — one grammar, not two. Before this, the
 * capture inputs took the positional form only, and the keyed form an agent had
 * just used in the XML parsed to nothing: `undefined` reads as "no position
 * given", so the shot came back framed from wherever the camera already was, with
 * no error to say why.
 */
describe('capturePoint — capture framing uses the scene DSL vector grammar', () => {
  it('reads the keyed form, defaults omitted axes to 0, and still reads the positional form', () => {
    expect(capturePoint('y: 6; z: 12')?.toArray()).toEqual([0, 6, 12]);
    expect(capturePoint('0 6 12')?.toArray()).toEqual([0, 6, 12]);
    expect(capturePoint(undefined)).toBeUndefined(); // an absent lookAt is not an error
  });

  it('rejects a malformed point loudly instead of silently framing from somewhere else', () => {
    expect(() => capturePoint('y: six')).toThrow(/expected a number/);
    expect(() => capturePoint('0 6')).toThrow(/a vec3/);
  });
});
