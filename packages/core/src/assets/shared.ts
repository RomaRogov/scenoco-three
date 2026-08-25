/**
 * Who owns a geometry, a material or a texture — the module that created it, or the scene that
 * happens to be using it.
 *
 * `Scene.unload` frees the GPU resources it can reach, which is right for anything the scene
 * built and wrong for anything an asset document exports. Fifty scenes may import one
 * `brick.material.xml`; the first one to unload must not dispose it out from under the rest.
 *
 * Unity draws this line with `sharedMaterial` and `material`: the first is the asset, the second
 * is this renderer's own copy. Same words here. Everything an asset document produces is
 * `shared()`; everything built at runtime — a procedural geometry, the copy
 * `Object3D.uniqueMaterial()` makes — is not, and is still freed on unload.
 *
 * The mark is a call in the generated code rather than a flag some other layer sets, so reading
 * the file tells you the lifetime.
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
 * Scene unload leaves it alone from here on. This is what every generated asset module wraps
 * its export in; hand-written code that exports a shared resource should do the same.
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
