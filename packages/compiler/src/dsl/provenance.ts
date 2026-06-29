/**
 * Editor-facing provenance for a compiled scene. The compiled form is **flat** —
 * prefab instances are expanded and material/geometry `src=` is inlined — so the
 * editor can no longer tell which nodes came from a prefab or which attachments
 * came from a file. The compiler emits this sidecar (index-aligned with
 * `CompiledScene.nodes` / `.attachments`) so the editor can apply its read-only
 * rules: prefab content and src-loaded attachments are not directly editable.
 */
export type NodeOrigin =
  | { kind: 'scene' } // authored directly in this file — fully editable
  | { kind: 'prefab-root'; src: string } // a scene-level <PrefabInstance> root — src + transform editable
  | { kind: 'prefab-internal' }; // expanded from inside a prefab — read-only

export interface SceneProvenance {
  /** One per `CompiledScene.nodes[i]`. */
  nodes: NodeOrigin[];
  /** The `src=` a `CompiledScene.attachments[i]` was loaded from, or null if inline. */
  attachments: (string | null)[];
}
