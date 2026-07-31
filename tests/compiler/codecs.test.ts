import { describe, expect, it } from 'vitest';
import { codecs, parseArrayLiteral, parseScalarArray, serializeScalarArray } from '@scenoco-three/compiler';

describe('scalar attribute codecs', () => {
  it('parses float/int/bool strictly and rejects junk', () => {
    expect(codecs.float.parse('1.5')).toEqual({ ok: true, value: 1.5 });
    expect(codecs.float.parse('abc').ok).toBe(false);
    expect(codecs.int.parse('32')).toEqual({ ok: true, value: 32 });
    expect(codecs.int.parse('1.5').ok).toBe(false); // non-integer
    expect(codecs.bool.parse('true')).toEqual({ ok: true, value: true });
    expect(codecs.bool.parse('1').ok).toBe(false); // only true/false
  });

  it('parses/serializes vec3, euler (degrees, no build-time conversion) and color (hex/named → hex int)', () => {
    expect(codecs.vec3.parse('0 1.5 -3')).toEqual({ ok: true, value: [0, 1.5, -3] });
    expect(codecs.vec3.parse('0 1').ok).toBe(false); // needs 3
    expect(codecs.vec3.serialize([0, 1.5, -3])).toBe('y: 1.5; z: -3');

    // Euler stays degrees end to end — the deg→rad conversion moved to runtime
    // (Object3D.eulerAngles), so the codec no longer touches the numbers.
    const euler = codecs.euler.parse('0 90 0');
    expect(euler.ok).toBe(true);
    if (euler.ok) {
      expect(euler.value).toEqual([0, 90, 0]);
      expect(codecs.euler.serialize(euler.value)).toBe('y: 90');
    }
    expect(codecs.color.parse('#ffcc00')).toEqual({ ok: true, value: 0xffcc00 });
    expect(codecs.color.parse('tomato').ok).toBe(true);
    expect(codecs.color.parse('notacolor').ok).toBe(false);
    expect(codecs.color.serialize(0xffcc00)).toBe('#ffcc00');
  });
});

describe('keyed vector values', () => {
  it('parses keyed axes in any order, filling omitted ones with the identity', () => {
    expect(codecs.vec3.parse('y: 1.15; z: -0.24')).toEqual({ ok: true, value: [0, 1.15, -0.24] });
    // Order-independent — the point of naming the axes.
    expect(codecs.vec3.parse('z: -0.24; y: 1.15')).toEqual({ ok: true, value: [0, 1.15, -0.24] });
    // Whitespace-tolerant, and a trailing ";" is a harmless CSS habit.
    expect(codecs.vec3.parse('  x:1 ;  y : 2 ; ')).toEqual({ ok: true, value: [1, 2, 0] });
    expect(codecs.vec2.parse('y: 4')).toEqual({ ok: true, value: [0, 4] });
  });

  it('emits the keyed form, eliding identity axes', () => {
    expect(codecs.vec3.serialize([0, 1.15, -0.24])).toBe('y: 1.15; z: -0.24');
    expect(codecs.vec3.serialize([1, 2, 3])).toBe('x: 1; y: 2; z: 3');
    // An all-identity vector must never serialize to an empty attribute value.
    expect(codecs.vec3.serialize([0, 0, 0])).toBe('x: 0; y: 0; z: 0');
  });

  it('treats scale as an ordinary vec3, exactly as three.js does', () => {
    // `scale` is a plain Vector3 in three.js, so it gets no special value type
    // here either: one rule, "an omitted axis is 0", with no exceptions.
    expect(codecs.vec3.parse('x: 2')).toEqual({ ok: true, value: [2, 0, 0] });
    expect(codecs.vec3.serialize([2, 1, 1])).toBe('x: 2; y: 1; z: 1');
    // A bare number is an arity error everywhere — never a silent spread across
    // all three axes, which would place `position="2"` at (2,2,2).
    const bare = codecs.vec3.parse('2');
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(bare.message).toContain('expected a vec3');
  });

  it('rejects an unknown or repeated axis by name', () => {
    const unknown = codecs.vec3.parse('w: 1');
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.message).toContain('unknown axis "w"');
    const dupe = codecs.vec3.parse('y: 1; y: 2');
    expect(dupe.ok).toBe(false);
    if (!dupe.ok) expect(dupe.message).toContain('twice');
  });

  it('keeps authored precision on position/scale, and trims dust only on euler', () => {
    // Rounding a position would silently degrade an authored value every time the
    // file round-trips through the serializer.
    expect(codecs.vec3.serialize([0, 12.984195533949313, 0])).toBe('y: 12.984195533949313');
    expect(codecs.vec3.serialize([1.2345678901, 0, 0])).toBe('x: 1.2345678901');
    // Euler numbers come back from a radian conversion, so dust is expected there.
    expect(codecs.euler.serialize([0, 89.99999999999999, 0])).toBe('y: 90');
  });

  it('never emits a comma, so arrays of vectors stay parseable', () => {
    // parseArrayLiteral splits on ",", so a comma in any scalar's wire form would
    // make arrays of that scalar unparseable. This is why the separator is ";".
    for (const t of ['vec2', 'vec3', 'euler'] as const) {
      expect(codecs[t].serialize([1, 2, 3].slice(0, t === 'vec2' ? 2 : 3))).not.toContain(',');
    }
  });
});

describe('array codecs', () => {
  it('parses bracketed scalar arrays (float/vec3/color) and reports the element index on error', () => {
    expect(parseArrayLiteral('[]')).toEqual({ ok: true, value: [] });
    expect(parseArrayLiteral('1,2,3').ok).toBe(false); // requires brackets
    expect(parseScalarArray('[1,2.5,-3]', 'float')).toEqual({ ok: true, value: [1, 2.5, -3] });
    expect(parseScalarArray('[0 1 0,1 0 0]', 'vec3')).toEqual({ ok: true, value: [[0, 1, 0], [1, 0, 0]] });
    expect(parseScalarArray('[#ff0000,#00ff00]', 'color')).toEqual({ ok: true, value: [0xff0000, 0x00ff00] });
    const bad = parseScalarArray('[1,bad,3]', 'float');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain('element 1');
  });

  it('round-trips scalar arrays through serialize', () => {
    const parsed = parseScalarArray('[0 1 0,1 0 0]', 'vec3');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(serializeScalarArray(parsed.value, 'vec3')).toBe('[0 1 0,1 0 0]');
    expect(serializeScalarArray([], 'float')).toBe('[]');
  });
});
