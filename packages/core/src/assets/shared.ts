/**
 * Who owns a geometry, a material or a texture — the module that created it, or the scene using it.
 *
 * `Scene.unload` frees the GPU resources it can reach, which is right for whatever the scene
 * built and wrong for a module-level export. Fifty scenes may import one material; the first to
 * unload must not dispose it out from under the rest.
 *
 * Unity draws the line with `sharedMaterial` and `material`: the asset, and this renderer's own
 * copy. Same words here. A module-level resource is `shared()`; anything built at runtime — a
 * procedural geometry, the copy `Object3D.uniqueMaterial()` makes — is not, and is freed on
 * unload.
 */

/** Everything marked shared, so `disposeAssets` can free them and disposal can skip them. */
const owned = new Set<object>();

/**
 * Mark a value as owned by the module that created it, and hand it back.
 *
 * ```ts
 * export const brick = shared(new BoxGeometry(1.2, 0.4, 0.5));
 * ```
 *
 * Scene unload leaves it alone from here on. Wrap anything a module exports for others to use.
 */
export function shared<T>(value: T): T {
  if (value !== null && typeof value === 'object') owned.add(value as object);
  return value;
}

/** True if `value` was marked with {@link shared}. */
export function isShared(value: unknown): boolean {
  return value !== null && typeof value === 'object' && owned.has(value as object);
}

/**
 * Free every shared asset and forget them.
 *
 * A game never needs this — shared assets are meant to live as long as the page. Tests and HMR
 * do, which is the whole reason it exists.
 */
export function disposeAssets(): void {
  for (const value of owned) {
    (value as { dispose?: () => void }).dispose?.();
  }
  owned.clear();
}
