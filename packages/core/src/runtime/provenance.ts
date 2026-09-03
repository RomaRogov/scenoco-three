import type { Object3D } from 'three';

/**
 * Where a node came from — a source file, and a position in it.
 *
 * A tool that builds scenes from source can stamp this onto the nodes it makes, and then go from
 * a live `Object3D` back to the lines that made it. Nothing in the runtime reads it; a game that
 * builds its scenes in code has none of it, and loses nothing.
 */
export interface Provenance {
  /** Path of the source file, relative to the project root. */
  file: string;
  /**
   * 1-based line and column of the element that made this node.
   *
   * An identity rather than a cursor position: whoever wrote the stamp and whoever reads it
   * agree on the convention, and the pair is unique and in source order.
   */
  line: number;
  column: number;
}

/**
 * Where `object` came from, or null if nothing stamped it.
 *
 * Null is the honest answer for a node built at runtime: it has no source to point at.
 */
export function provenanceOf(object: Object3D): Provenance | null {
  const stamp = (object.userData as { scenoco?: Provenance }).scenoco;
  return stamp?.file !== undefined ? stamp : null;
}

/**
 * The nearest stamped node at or above `object`, and its provenance.
 *
 * A click lands on whatever mesh the ray hit, which inside a loaded model is some deeply nested
 * part nobody wrote. Walking up finds the thing that was.
 */
export function findProvenance(
  object: Object3D,
): { object: Object3D; provenance: Provenance } | null {
  for (let node: Object3D | null = object; node; node = node.parent) {
    const provenance = provenanceOf(node);
    if (provenance) return { object: node, provenance };
  }
  return null;
}

/**
 * Every node under `root` stamped with `file`, in source order.
 *
 * A prefab's contents are stamped with the prefab's own file, not with whatever spawned it, so
 * they do not appear here — one file's nodes, and no further.
 */
export function nodesFrom(root: Object3D, file: string): Object3D[] {
  const found: Object3D[] = [];
  root.traverse((node) => {
    if (provenanceOf(node)?.file === file) found.push(node);
  });
  return found;
}
