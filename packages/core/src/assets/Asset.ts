/**
 * A resource whose bytes arrive later — a model, an audio clip. `await loadAssets(…)` in `main.ts`,
 * before `play`, and it is ready when the scene is built. A texture is not one of these: three.js
 * hands that back at once and fills in the image when it lands.
 */
export abstract class Asset<T> {
  /** Where the data comes from. */
  readonly url: string;

  private loaded: T | undefined;
  private pending: Promise<T> | undefined;

  constructor(url: string) {
    this.url = url;
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
          'Await it before use: `await loadAssets(theAsset)` in the scene that needs it.',
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

/** Anything {@link loadAssets} knows how to wait for. */
export type Loadable = Asset<unknown> | object;

/**
 * Wait for every asset in the list — `await loadAssets(hero, music)` in `main.ts`, before `play`.
 * Takes textures as well as `Asset`s, loads them in parallel, and costs nothing for one already loaded.
 */
export async function loadAssets(...assets: readonly Loadable[]): Promise<void> {
  await Promise.all(
    assets.map((asset) => (asset instanceof Asset ? asset.load() : pending.get(asset))),
  );
}
