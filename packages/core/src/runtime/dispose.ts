import type { Material, Mesh, Object3D } from 'three';
import { isShared } from '../assets/shared.js';

/** Owned by the module that made it, or held by an explicit `keepAlive` — either way, not ours. */
function survives(resource: unknown, kept: Set<unknown> | null): boolean {
  return isShared(resource) || kept?.has(resource) === true;
}

function disposeMaterial(material: Material, kept: Set<unknown> | null): void {
  if (survives(material, kept)) return;
  // Textures hang off materials as plain properties; three.js exposes no list to walk.
  for (const value of Object.values(material)) {
    if (value && typeof value === 'object' && 'isTexture' in value && !survives(value, kept)) {
      (value as { dispose(): void }).dispose();
    }
  }
  material.dispose();
}

/**
 * Release the GPU-side resources reachable from an object tree: geometries, materials, and
 * the textures those materials reference.
 *
 * `Scene.unload` calls this unless `disposeOnUnload` is off. Two things are skipped:
 *
 * - anything marked `shared()` — the module that created it owns it, and other scenes still
 *   import it. Everything an asset document exports is marked, which is what makes it safe for
 *   fifty scenes to share one material;
 * - anything in `kept`, which is what `Scene.keepAlive` fills, for resources shared by
 *   hand-written code.
 *
 * What is left is what the scene itself built — a procedural geometry, the copy
 * `Object3D.uniqueMaterial()` makes — and freeing that is the whole point.
 */
export function disposeSceneResources(root: Object3D, kept: Set<unknown> | null = null): void {
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.geometry && !survives(mesh.geometry, kept)) mesh.geometry.dispose();
    const material = mesh.material;
    if (!material) return;
    if (Array.isArray(material)) {
      for (const entry of material) disposeMaterial(entry, kept);
    } else {
      disposeMaterial(material, kept);
    }
  });
}
