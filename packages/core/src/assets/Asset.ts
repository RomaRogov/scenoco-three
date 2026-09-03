/**
 * A resource whose bytes arrive later — a model, an audio clip.
 *
 * A texture needs none of this: three.js hands one back at once and fills in the image when it
 * lands. A glTF or an `AudioBuffer` does not exist until it has been fetched and parsed.
 *
 * Await them in `onLoad` and the scene is not live until they are ready:
 *
 * ```ts
 * override async onLoad(): Promise<void> {
 *   await loadAssets(hero, footsteps);
 *   this.instantiate(hero, { position: new Vector3(0, 1, 0) });
 * }
 * ```
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

  /**
   * The loaded value. Throws before the load finishes, naming the call that was missed — a
   * silent `undefined` surfaces as a missing model frames later with nothing pointing at it.
   */
  get value(): T {
    if (this.loaded === undefined) {
      throw new Error(
        `[scenoco] ${this.constructor.name} "${this.url}" is not loaded yet. ` +
          'Await it before use: `await loadAssets(theAsset)` in the scene that needs it.',
      );
    }
    return this.loaded;
  }

  /**
   * Fetch and parse, or hand back what is already there. Concurrent callers share one promise,
   * so ten emitters on one clip cause one fetch.
   */
  load(): Promise<T> {
    if (this.loaded !== undefined) return Promise.resolve(this.loaded);
    this.pending ??= this.fetch().then((value) => {
      this.loaded = value;
      this.pending = undefined;
      return value;
    });
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

  /** Release the loaded value's GPU or audio resources. Override where there is something to free. */
  protected free(_value: T): void {}
}

/**
 * The in-flight load behind a value that is usable before it finishes — a `Texture`.
 *
 * A texture is not an `Asset`: it is usable at once, and wrapping it would mean two names for
 * one texture. Recording its promise here lets a scene wait anyway, and show no untextured
 * first frame.
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
 * Wait for every asset in the list — call it at the top of `onLoad`.
 *
 * Takes textures as well as `Asset`s, so one call covers a whole scene. They load in parallel,
 * and anything already loaded costs nothing.
 */
export async function loadAssets(...assets: readonly Loadable[]): Promise<void> {
  await Promise.all(
    assets.map((asset) => (asset instanceof Asset ? asset.load() : pending.get(asset))),
  );
}
