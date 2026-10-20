import type { Object3D } from 'three';

/**
 * What a node's own elements built — a `<BoxGeometry>` or `<MeshStandardMaterial>` written inside
 * it, a texture written inside that — is the node's, and goes with it: destroying a node frees the
 * GPU resources its elements made. What a scene only *names* in a prop — a material constant in
 * `assets.ts`, a `sharedTexture`, a loaded model's parts — is someone else's and is left alone,
 * however many scenes use it. Unity's `material` versus `sharedMaterial`, decided by how the scene
 * is written rather than by a mark.
 */
const owners = new WeakMap<object, object>();

/**
 * @internal `child` was written as an element inside `parent` — `<Mesh><BoxGeometry /></Mesh>` —
 * so it is `parent`'s. A value passed as a prop (`material={paint.wall}`) never is, wherever it
 * was made.
 */
export function ownedBy(child: object, parent: object): void {
  if (typeof (child as { dispose?: unknown }).dispose === 'function') owners.set(child, parent);
}

/** @internal free what the elements under `root` built: geometries, materials and their textures, lights' shadows. */
export function disposeBuilt(root: Object3D): void {
  const free = (value: unknown, owner: object): void => {
    if (!value || typeof value !== 'object' || owners.get(value) !== owner) return;
    owners.delete(value);
    (value as { dispose(): void }).dispose();
  };
  root.traverse((node) => {
    const drawn = node as Object3D & { geometry?: unknown; material?: unknown; background?: unknown; environment?: unknown };
    free(drawn.geometry, node);
    for (const material of Array.isArray(drawn.material) ? drawn.material : [drawn.material]) {
      if (!material || typeof material !== 'object') continue;
      // A material's own maps, written inside it: `<CanvasTexture attach="map" />`.
      for (const value of Object.values(material)) if ((value as { isTexture?: boolean } | null)?.isTexture) free(value, material);
      free(material, node);
    }
    free(drawn.background, node);
    free(drawn.environment, node);
    // A light's shadow map is the light's own, made by the renderer the first frame it casts: a
    // 2048² target per sun, every load, until a phone's GPU gives up and drops the context.
    if ((node as { isLight?: boolean }).isLight) (node as Object3D & { dispose(): void }).dispose();
  });
}
