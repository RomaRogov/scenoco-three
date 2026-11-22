/**
 * A resource whose bytes arrive later — a model, an audio clip. Declared — `const tree = sharedModel(url)`,
 * in a scene file or any other — it is loaded by `play` before the first scene is built, as Unity loads a
 * scene's assets with it. `await loadAssets(…)` loads it sooner (a loading screen) or under `simulate`.
 * A texture is not one of these: three.js hands that back at once and fills in the image when it lands.
 */
export abstract class Asset<T> {
  /** Where the data comes from. */
  readonly url: string;

  private loaded: T | undefined;
  private pending: Promise<T> | undefined;

  constructor(url: string) {
    this.url = url;
    declared.add(this);
  }

  /** True once the bytes have arrived and been parsed. */
  get isLoaded(): boolean {
    return this.loaded !== undefined;
  }

  /** The loaded value. Throws before the load finishes, naming the call that was missed. */
  get value(): T {
    if (this.loaded === undefined) {
      throw new Error(
        `[scenoco] ${this.constructor.name} "${this.url}" is not loaded yet. ` +
          'play loads what is declared before its first scene; declared later, or under simulate, `await loadAssets(theAsset)` first.',
      );
    }
    return this.loaded;
  }

  /** Fetch and parse, or hand back what is there. Concurrent callers share one promise. */
  load(): Promise<T> {
    if (this.loaded !== undefined) return Promise.resolve(this.loaded);
    this.pending ??= this.fetch().then(
      (value) => {
        this.loaded = value;
        this.pending = undefined;
        return value;
      },
      (error: unknown) => {
        // Forgotten on the way out, so a retry is a retry. Kept, the first failure — a dropped
        // connection, a file not deployed yet — was the answer every later call got too, for
        // the life of the page.
        this.pending = undefined;
        throw error;
      },
    );
    return this.pending;
  }

  /** Free whatever the load produced, and forget it. */
  dispose(): void {
    if (this.loaded !== undefined) this.free(this.loaded);
    this.loaded = undefined;
    this.pending = undefined;
  }

  /** Do the actual loading. One implementation per resource kind. */
  protected abstract fetch(): Promise<T>;

  /** Loaded now, from `value`: for an asset a game makes at runtime rather than reads from a file. */
  protected provide(value: T): void {
    this.loaded = value;
    this.pending = undefined;
  }

  /** Release the loaded value's GPU or audio resources. Override where there is something to free. */
  protected free(_value: T): void {}
}

/** Every asset made: what `play` loads before its first scene. Only what a game declared, never a URL found. */
const declared = new Set<Asset<unknown>>();

/**
 * @internal Load what is declared and not loaded yet; null when nothing waits. A file that fails is said
 * once, by name, and the game goes on: what places it then says it isn't loaded.
 */
export function loadDeclared(): Promise<void> | null {
  const waiting = [...declared].filter((asset) => !asset.isLoaded);
  if (!waiting.length) return null;
  return Promise.all(
    waiting.map((asset) =>
      asset.load().catch((error: unknown) => {
        console.error(`[scenoco] ${asset.constructor.name} "${asset.url}" did not load: ${error instanceof Error ? error.message : String(error)}`);
      }),
    ),
  ).then(() => undefined);
}

/**
 * The in-flight load behind a value usable before it finishes — a `Texture`, which is not an
 * `Asset` because wrapping it would mean two names for one texture. Recorded so a scene can
 * wait for it anyway.
 */
const pending = new WeakMap<object, Promise<unknown>>();

/** @internal record the load behind a synchronously-usable value. */
export function trackLoad(value: object, load: Promise<unknown>): void {
  // A failure is reported by the loader itself; this promise only says "no longer in flight",
  // so a scene is never held up forever by one missing file.
  pending.set(value, load.catch(() => undefined));
}

/** Values that load as an asset: a model's prefab is its model. */
const standsFor = new WeakMap<object, Asset<unknown>>();

/** @internal `value` loads as `asset` does: `loadAssets(value)` waits for the asset. */
export function loadsAs(value: object, asset: Asset<unknown>): void {
  standsFor.set(value, asset);
}

/** @internal The asset a value stands for, as {@link loadsAs} recorded it. */
export function assetOf(value: unknown): Asset<unknown> | undefined {
  return value && (typeof value === 'object' || typeof value === 'function') ? standsFor.get(value) : undefined;
}

/** Anything {@link loadAssets} knows how to wait for. */
export type Loadable = Asset<unknown> | object;

/**
 * Wait for every asset in the list — `await loadAssets(hero, music)` in `main.ts`, before `play`.
 * Takes textures and a model's prefab as well as `Asset`s, loads them in parallel, and costs nothing for one already loaded.
 */
export async function loadAssets(...assets: readonly Loadable[]): Promise<void> {
  await Promise.all(
    assets.map((asset) => (asset instanceof Asset ? asset.load() : (standsFor.get(asset)?.load() ?? pending.get(asset)))),
  );
}
