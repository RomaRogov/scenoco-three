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

  it('parses/serializes vec3, euler (deg↔rad) and color (hex/named → hex int)', () => {
    expect(codecs.vec3.parse('0 1.5 -3')).toEqual({ ok: true, value: [0, 1.5, -3] });
    expect(codecs.vec3.parse('0 1').ok).toBe(false); // needs 3
    expect(codecs.vec3.serialize([0, 1.5, -3])).toBe('0 1.5 -3');

    const euler = codecs.euler.parse('0 90 0');
    expect(euler.ok).toBe(true);
    if (euler.ok) {
      expect((euler.value as number[])[1]).toBeCloseTo(Math.PI / 2);
      expect(codecs.euler.serialize(euler.value)).toBe('0 90 0');
    }
    expect(codecs.color.parse('#ffcc00')).toEqual({ ok: true, value: 0xffcc00 });
    expect(codecs.color.parse('tomato').ok).toBe(true);
    expect(codecs.color.parse('notacolor').ok).toBe(false);
    expect(codecs.color.serialize(0xffcc00)).toBe('#ffcc00');
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
