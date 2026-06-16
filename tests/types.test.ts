import { describe, expect, it } from 'vitest';
import { codecs } from '@scenoco-three/compiler';

describe('attribute codecs', () => {
  it('parses floats and rejects junk', () => {
    expect(codecs.float.parse('1.5')).toEqual({ ok: true, value: 1.5 });
    expect(codecs.float.parse('-2')).toEqual({ ok: true, value: -2 });
    const bad = codecs.float.parse('abc');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain('expected a number');
  });

  it('parses ints and rejects non-integers', () => {
    expect(codecs.int.parse('32')).toEqual({ ok: true, value: 32 });
    const bad = codecs.int.parse('1.5');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain('expected an integer');
  });

  it('parses booleans strictly', () => {
    expect(codecs.bool.parse('true')).toEqual({ ok: true, value: true });
    expect(codecs.bool.parse('false')).toEqual({ ok: true, value: false });
    expect(codecs.bool.parse('1').ok).toBe(false);
  });

  it('parses vec3 as space-separated numbers', () => {
    expect(codecs.vec3.parse('0 1.5 -3')).toEqual({ ok: true, value: [0, 1.5, -3] });
    const wrong = codecs.vec3.parse('0 1');
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.message).toContain('3 space-separated numbers');
  });

  it('converts euler degrees to radians and back', () => {
    const parsed = codecs.euler.parse('0 90 0');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect((parsed.value as number[])[1]).toBeCloseTo(Math.PI / 2);
      expect(codecs.euler.serialize(parsed.value)).toBe('0 90 0');
    }
  });

  it('parses hex and named colors to a hex int', () => {
    expect(codecs.color.parse('#ffcc00')).toEqual({ ok: true, value: 0xffcc00 });
    expect(codecs.color.parse('tomato').ok).toBe(true);
    const bad = codecs.color.parse('notacolor');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain('hex color');
    expect(codecs.color.serialize(0xffcc00)).toBe('#ffcc00');
  });

  it('round-trips vectors', () => {
    expect(codecs.vec3.serialize([0, 1.5, -3])).toBe('0 1.5 -3');
  });
});
