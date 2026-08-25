import type { Object3D } from 'three';

/**
 * Where a node came from — the document and the element that built it.
 *
 * Written into `userData.scenoco` by generated code, but only when the build asked for it:
 * `scenoco()` turns it on while a dev server is serving and off when it builds, the way
 * sourcemaps already work. A shipped game carries none of this.
 *
 * It is what lets an editor go from a live `Object3D` — the one under the cursor — back to the
 * three lines of XML that made it. v1 did that by aligning a compiled bundle's `nodes[]` with the
 * objects the runtime built; generated code has no such array, so the node carries the answer
 * itself.
 */
export interface Provenance {
  /** Project-relative path of the document — `assets/scenes/level1.scene.xml`. */
  file: string;
  /**
   * 1-based line and column of the element that built this node, as the SceNoCo parser reports
   * them — which is where the **open tag ends**, not where it begins.
   *
   * That is fine, and deliberate: this is an *identity*, not a cursor position. An editor parses
   * the same document with the same parser, so the two sides agree exactly, and the pair is
   * unique and in document order. Only a text view wanting to place a caret would care, and it
   * has the element in hand by then.
   */
  line: number;
  column: number;
}

/**
 * Where `object` came from, or null for anything a document did not build.
 *
 * Null is the honest answer for a node spawned by game code at runtime: it has no source, so
 * there is nothing to select and nothing to edit.
 */
export function provenanceOf(object: Object3D): Provenance | null {
  const stamp = (object.userData as { scenoco?: Provenance }).scenoco;
  return stamp?.file !== undefined ? stamp : null;
}

/**
 * The nearest node at or above `object` that a document built, and its provenance.
 *
 * A click lands on whatever mesh the ray hit, which inside a glTF is some deeply nested part
 * nobody authored. Walking up finds the thing the document actually named.
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
 * Every node in `root` that came from `file`, in document order.
 *
 * The editor's tree is the *document's* tree, so this is how the live scene is matched to it —
 * and why a prefab's contents do not appear: they are stamped with the prefab's own file, not
 * with the document that spawned it, which is exactly the boundary an editor should not cross.
 */
export function nodesFrom(root: Object3D, file: string): Object3D[] {
  const found: Object3D[] = [];
  root.traverse((node) => {
    if (provenanceOf(node)?.file === file) found.push(node);
  });
  return found;
}
