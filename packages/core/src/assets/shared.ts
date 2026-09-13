/**
 * Who owns a geometry, material or texture — the module that created it, or the scene using it.
 *
 * `Scene.unload` frees what the scene built; a module-level export is `shared()` and survives,
 * because fifty scenes may import one material. Unity's `sharedMaterial`/`material` split.
 */

/** Everything marked shared, so unload can skip them and `disposeAssets` can free them. */
const owned = new Set<object>();

/** Mark a value as owned by its module, so scene unload leaves it alone, and hand it back. */
export function shared<T>(value: T): T {
  if (value !== null && typeof value === 'object') owned.add(value as object);
  return value;
}

/** True if `value` was marked with {@link shared}. */
export function isShared(value: unknown): boolean {
  return value !== null && typeof value === 'object' && owned.has(value as object);
}

/** Free every shared asset and forget them. For tests and HMR; a game never needs it. */
export function disposeAssets(): void {
  for (const value of owned) {
    (value as { dispose?: () => void }).dispose?.();
  }
  owned.clear();
}
