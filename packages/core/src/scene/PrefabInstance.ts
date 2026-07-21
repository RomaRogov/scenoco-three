import { Group, type Object3D } from 'three';
import type { PrefabAsset } from './PrefabAsset.js';

/**
 * The root of an instantiated prefab — a real `Object3D` (a `Group`) that *is* the
 * instance, holding the prefab's content as its children. Created automatically by
 * `engine.instantiate` / `PrefabAsset.spawn` (Unity/Cocos: an instantiated prefab
 * is a GameObject/Node you can place, parent, and destroy as one unit).
 *
 * Two things live on it beyond a plain Group:
 *
 *  - **`prefabAsset`** — the {@link PrefabAsset} it was made from, so you can spawn
 *    more of the same later straight off an existing instance
 *    (`inst.prefabAsset?.spawn(...)`), without threading the original reference
 *    around.
 *  - **`scope`** — a dynamic id-context map (internal `sceneId` → node), so the
 *    prefab's internals stay addressable by a slash-scoped path once the instance
 *    itself is named. Give the instance a `sceneId` and
 *    `engine.findObject('enemy1/turret')` resolves `turret` inside it — even
 *    though it was spawned at runtime, and even if another instance uses the same
 *    internal ids. Nested instances compose (`a/b/c`).
 */
export class PrefabInstance extends Group {
  /** Brand for cheap `instanceof`-free checks across module/realm boundaries. */
  readonly isPrefabInstance = true as const;

  /** The asset this instance was created from — spawn more via `prefabAsset?.spawn()`. */
  prefabAsset: PrefabAsset | null = null;

  /**
   * Internal `sceneId` → node, for slash-scoped lookup. Populated at instantiate
   * from the prefab content's own ids (not including this root). First id wins on
   * a duplicate, mirroring the engine's flat index.
   */
  readonly scope = new Map<string, Object3D>();

  /**
   * Resolve an internal id within this instance. A plain id hits {@link scope}; a
   * slash path (`turret/barrel`) walks into a nested `PrefabInstance` child.
   */
  find(innerId: string): Object3D | undefined {
    const slash = innerId.indexOf('/');
    if (slash === -1) return this.scope.get(innerId);
    const child = this.scope.get(innerId.slice(0, slash));
    return child instanceof PrefabInstance ? child.find(innerId.slice(slash + 1)) : undefined;
  }
}

/**
 * Build a `PrefabInstance` scope map from an already-instantiated content root:
 * every descendant with a `sceneId`, stopping at (but including) a nested
 * `PrefabInstance` — whose own internals belong to *its* scope, reachable through
 * the composed path.
 */
export function buildScope(instance: PrefabInstance, content: Object3D): void {
  const visit = (node: Object3D, isRoot: boolean): void => {
    if (node.sceneId && !instance.scope.has(node.sceneId)) instance.scope.set(node.sceneId, node);
    // A nested instance is reachable by its own id, but its internals belong to
    // its scope (composed path), so don't descend into it.
    if (!isRoot && node instanceof PrefabInstance) return;
    for (const child of node.children) visit(child, false);
  };
  visit(content, true);
}
