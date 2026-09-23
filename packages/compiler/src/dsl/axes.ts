const AXES = ['x', 'y', 'z', 'w'] as const;

/**
 * A vector's default, axis by axis: the property's declared default — a field's own
 * `new Vector3(0, 1, 0)`, or the axis form — and zeros where it has none.
 */
export function defaultAxes(declared: string | undefined, arity: number): number[] {
  const parts = new Array<number>(arity).fill(0);
  const text = declared?.trim() ?? '';
  const call = /^new\s+(?:\w+\.)?Vector[234]\(([^)]*)\)$/.exec(text);
  const values = call
    ? call[1]!.split(',').map((n, index) => [index, Number(n.trim())] as const)
    : text.split(';').map((chunk) => {
        const [axis, number] = chunk.split(':');
        return [AXES.indexOf(axis?.trim() as (typeof AXES)[number]), Number(number?.trim())] as const;
      });
  for (const [index, number] of values) {
    if (index >= 0 && index < arity && Number.isFinite(number)) parts[index] = number;
  }
  return parts;
}
