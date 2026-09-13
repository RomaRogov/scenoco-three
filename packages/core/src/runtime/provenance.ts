import type { Object3D } from 'three';

/**
 * Where a node came from — a source file, and a position in it.
 *
 * Stamped by whatever builds scenes from source, so a live `Object3D` leads back to the lines
 * that made it. Nothing in the runtime reads it.
 */
export interface Provenance {
  /** Path of the source file, relative to the project root. */
  file: string;
  /** 1-based line and column of the element that made this node — an identity, not a cursor. */
  line: number;
  column: number;
}

/** Where `object` came from, or null — which is the honest answer for a node built at runtime. */
export function provenanceOf(object: Object3D): Provenance | null {
  const stamp = (object.userData as { scenoco?: Provenance }).scenoco;
  return stamp?.file !== undefined ? stamp : null;
}

/**
 * The nearest stamped node at or above `object`. A click lands on whatever mesh the ray hit,
 * which inside a loaded model is some nested part nobody wrote; walking up finds the one written.
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
 * Every node under `root` stamped with `file`, in source order. A spawned prefab's contents
 * carry the prefab's own file, so they are not included.
 */
export function nodesFrom(root: Object3D, file: string): Object3D[] {
  const found: Object3D[] = [];
  root.traverse((node) => {
    if (provenanceOf(node)?.file === file) found.push(node);
  });
  return found;
}
