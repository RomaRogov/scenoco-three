import type { PropInfo, ValueShape } from '@scenoco-three/compiler';
import { defaultAxes } from '@scenoco-three/compiler/browser';

/**
 * A value as the inspector's widgets handle it: a number, a flag, some text, or a list of axes.
 *
 * The document stores attribute **text**, and the widgets — the number scrubber, the vector row,
 * the colour swatch — work in typed values. This is the pair of functions between them, and it
 * speaks the DSL's own grammar in both directions: `x: 1; y: 2` for a vector, `#rrggbb` for a
 * colour, degrees for a rotation. So what a widget writes is what a person would have written.
 */
export type Scalar = number | boolean | string | number[];

/**
 * Attribute text → a value a widget can edit, or undefined when there is nothing to show. A vector
 * axis the text leaves out takes `declared`, the property's default — as the compiler does.
 */
export function parseValue(shape: ValueShape, text: string | undefined, declared?: string): Scalar | undefined {
  if (text === undefined) return undefined;
  switch (shape) {
    case 'number': {
      const n = Number(text.trim());
      return Number.isFinite(n) ? n : 0;
    }
    case 'boolean':
      return text.trim() === 'true';
    case 'color':
      return colorToNumber(text);
    case 'vector2':
      return axes(text, 2, declared);
    case 'vector3':
    case 'euler':
      return axes(text, 3, declared);
    case 'vector4':
      return axes(text, 4, declared);
    default:
      return text;
  }
}

/** A value from a widget → the text the document gets. */
export function formatValue(shape: ValueShape, value: Scalar): string {
  switch (shape) {
    case 'number':
      return String(round(Number(value)));
    case 'boolean':
      return value ? 'true' : 'false';
    case 'color':
      return `#${Math.max(0, Math.round(Number(value))).toString(16).padStart(6, '0').slice(-6)}`;
    case 'vector2':
      return named(value as number[], ['x', 'y']);
    case 'vector3':
    case 'euler':
      return named(value as number[], ['x', 'y', 'z']);
    case 'vector4':
      return named(value as number[], ['x', 'y', 'z', 'w']);
    default:
      return String(value);
  }
}

/**
 * Something to render for an attribute the document does not write.
 *
 * The row still has to draw, and setting it is the whole point of it being there — so an unwritten
 * optional shows its declared default when it has one, and a neutral value when it does not.
 */
export function shownValue(prop: PropInfo, written: string | undefined): Scalar {
  return parseValue(prop.shape, written, prop.default) ?? parseValue(prop.shape, prop.default?.replace(/^['"]|['"]$/g, '')) ?? neutral(prop.shape);
}

function neutral(shape: ValueShape): Scalar {
  switch (shape) {
    case 'boolean':
      return false;
    case 'string':
    case 'enum':
    case 'nodeRef':
    case 'assetRef':
      return '';
    case 'vector2':
      return [0, 0];
    case 'vector3':
    case 'euler':
      return [0, 0, 0];
    case 'vector4':
      return [0, 0, 0, 0];
    default:
      return 0;
  }
}

/** Which widget renders a shape, or `null` for one no widget can edit. */
export function widgetFor(prop: PropInfo): ValueShape | null {
  switch (prop.shape) {
    case 'number':
    case 'boolean':
    case 'string':
    case 'color':
    case 'vector2':
    case 'vector3':
    case 'vector4':
    case 'euler':
    case 'enum':
    case 'nodeRef':
    case 'assetRef':
      return prop.shape;
    default:
      return null; // an array, or something the DSL cannot express
  }
}

function axes(text: string, arity: number, declared?: string): number[] {
  const out = defaultAxes(declared, arity);
  const names = ['x', 'y', 'z', 'w'];
  // The one spelling a document uses. A value that is not in it reads as zeroes, which is what
  // the compiler would have rejected anyway — the widget then writes it back correctly.
  for (const part of text.split(';')) {
    const [axis, value] = part.split(':');
    const index = names.indexOf((axis ?? '').trim());
    const n = Number((value ?? '').trim());
    if (index !== -1 && index < arity && Number.isFinite(n)) out[index] = n;
  }
  return out;
}

function named(values: number[], names: string[]): string {
  return names.map((name, i) => `${name}: ${round(values[i] ?? 0)}`).join('; ');
}

function colorToNumber(text: string): number {
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(text.trim());
  if (!hex) return 0;
  const digits = hex[1]!;
  return parseInt(digits.length === 3 ? digits.replace(/./g, (c) => c + c) : digits, 16);
}

/** Three decimals: a scrubbed number should not write `0.30000000000000004` into someone's file. */
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
