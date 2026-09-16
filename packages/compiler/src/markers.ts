/**
 * Take the build's markers out of a component's source before it runs.
 *
 * `@serializeField` and `@nonSerialized` are read by the scan and mean nothing to the page — and
 * a decorator is syntax no browser parses yet, so leaving one in is a `SyntaxError` at load. Each
 * marker and the import that brought it are overwritten with spaces, which keeps every other
 * offset where it was: the source map needs no rewriting, because nothing moved.
 *
 * The parse is the caller's: a bundler already has a TypeScript parser, and the compiler does not
 * need a second one to find a decorator.
 */

/** The module the markers come from. It exports nothing else, so its import goes as a whole. */
export const MARKER_MODULE = '@scenoco-three/compiler/serialize';

/** Read by name, as the scan reads them. */
const MARKERS = new Set(['serializeField', 'nonSerialized']);

/** As much of an ESTree node as this reads. */
export interface MarkerNode {
  type: string;
  start: number;
  end: number;
}

/**
 * A module's source with its markers blanked, or `null` to leave the file alone — anything that
 * is not TypeScript of the project's own, and anything that cannot contain one, is never parsed.
 */
export function withoutMarkers(code: string, id: string, parse: (id: string, code: string) => MarkerNode): string | null {
  const file = id.replace(/\?.*$/, '');
  if (!/\.(m?ts|tsx)$/.test(file) || file.includes('/node_modules/')) return null;
  if (!code.includes(MARKER_MODULE) && ![...MARKERS].some((name) => code.includes(`@${name}`))) return null;
  return stripMarkers(code, parse(file, code));
}

function stripMarkers(code: string, program: MarkerNode): string | null {
  const ranges: Array<[number, number]> = [];
  visit(program, (node) => {
    const value = node as MarkerNode & {
      source?: { value?: unknown };
      expression?: { type?: string; name?: string };
    };
    if (node.type === 'ImportDeclaration' && value.source?.value === MARKER_MODULE) {
      ranges.push([node.start, node.end]);
    } else if (
      node.type === 'Decorator' &&
      value.expression?.type === 'Identifier' &&
      MARKERS.has(value.expression.name ?? '')
    ) {
      ranges.push([node.start, node.end]);
    }
  });
  if (ranges.length === 0) return null;

  let out = code;
  for (const [start, end] of ranges) {
    out = out.slice(0, start) + out.slice(start, end).replace(/[^\n]/g, ' ') + out.slice(end);
  }
  return out;
}

function visit(node: unknown, found: (node: MarkerNode) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) visit(child, found);
    return;
  }
  if (typeof (node as MarkerNode).type === 'string') found(node as MarkerNode);
  for (const [key, child] of Object.entries(node)) if (key !== 'parent') visit(child, found);
}
