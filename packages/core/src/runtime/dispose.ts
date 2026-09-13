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
 * Release the GPU resources reachable from an object tree: geometries, materials and their
 * textures.
 *
 * Skips anything marked `shared()` — its module owns it and other scenes still import it — and
 * anything in `kept`, which `Scene.keepAlive` fills. What is left is what the scene built.
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
