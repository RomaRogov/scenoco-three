/**
 * A resource whose bytes arrive later — a model, an audio clip.
 *
 * A geometry or a material is built the moment its module is evaluated, and a texture is close
 * enough (three.js hands back a `Texture` immediately and fills the image in when it lands). A
 * glTF and an `AudioBuffer` cannot be: neither exists until it has been fetched and parsed.
 *
 * You rarely touch this. A document that references one compiles to a scene whose `onLoad`
 * awaits it before building anything, which is Unity's arrangement too — loading a scene loads
 * the assets it references, and nobody writes the load call.
 *
 * ```ts
 * // what `level1.scene.xml` compiles to
 * override async onLoad(): Promise<void> {
 *   await loadAssets(hero, footsteps);
 *   this.hero = this.instantiate(hero, { position: new Vector3(0, 1, 0) });
 * }
 * ```
 *
 * Spawning one from code later is the one case the compiler cannot see, so that is the one
 * place you write it yourself: `await loadAssets(...Enemy.assets)`.
 */
export abstract class Asset<T> {
  /** Where the bytes come from. */
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
   * The loaded value.
   *
   * Throws before the load finishes, naming the call that was missed. A silent `undefined` here
   * would surface as a missing model three frames later with nothing pointing at the cause.
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
   * Fetch and parse, or hand back what is already there.
   *
   * Idempotent and safe to call concurrently: the second caller gets the first call's promise,
   * so ten emitters sharing one clip cause one fetch.
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
 * A texture is not an `Asset`: three.js gives you the object immediately, so nothing has to
 * wait for it, and wrapping it would mean two names for one texture. But a scene that *does*
 * wait shows no untextured first frame, so the promise is recorded here where `loadAssets` can
 * find it, keyed by the texture itself rather than by its URL.
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
 * Wait for every asset in the list.
 *
 * This is what a generated scene calls at the top of `onLoad`, with the assets its document
 * references — you write it yourself only for something spawned from code later. Unity works
 * the same way: loading a scene loads what it references, and nobody writes the load call.
 *
 * Takes textures as well as `Asset`s, so one call covers a whole scene. They load in parallel,
 * and anything already loaded costs nothing.
 */
export async function loadAssets(...assets: readonly Loadable[]): Promise<void> {
  await Promise.all(
    assets.map((asset) => (asset instanceof Asset ? asset.load() : pending.get(asset))),
  );
}
