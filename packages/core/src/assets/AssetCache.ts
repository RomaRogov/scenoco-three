import { AudioLoader, TextureLoader, type Object3D } from 'three';

/**
 * The kind of external resource a `@property({ type: ValueType.String, asset })` field
 * references. Drives scene enumeration (which URLs to preload) and lets tooling
 * (editor/XSD) treat the attr as a texture/model/audio picker rather than a free
 * string.
 */
export type AssetKind = 'texture' | 'model' | 'audio';

/** Loads one URL into a runtime asset (a `Texture`, a glTF result, …). */
export type AssetLoader = (url: string) => Promise<unknown>;

/** Flag set on cache-owned `userData`, so scene-unload disposal leaves them alone. */
const MANAGED = '__assetManaged';

/**
 * A per-engine, URL-keyed cache of loaded runtime assets (textures, glTF models).
 * The preload providers fill it before a scene instantiates; attachments read it
 * synchronously in `attach(ctx.assets)`. Loaders are chosen by file extension and
 * are **lazy** — the heavy three.js loaders (glTF) are imported only when an asset
 * of that type is first loaded, so an asset-free build never pulls them in.
 *
 * Cache-owned resources are tagged so the engine's scene-unload disposal skips
 * them (a texture shared by many materials, or a glTF whose clones share its
 * geometry, must outlive any one scene); the cache frees them on `dispose`.
 */
export class AssetCache {
  private readonly cache = new Map<string, unknown>();
  /** Extension (lowercased, no dot) → loader. Overrides the built-in defaults. */
  private readonly loaders = new Map<string, AssetLoader>();

  /** Register a loader for one or more extensions (custom formats, or test stubs). */
  registerLoader(extensions: string[], loader: AssetLoader): void {
    for (const ext of extensions) this.loaders.set(ext.toLowerCase().replace(/^\./, ''), loader);
  }

  has(url: string): boolean {
    return this.cache.has(url);
  }

  /** The loaded asset for a URL, or `undefined` if it isn't loaded yet. */
  get<T = unknown>(url: string): T | undefined {
    return this.cache.get(url) as T | undefined;
  }

  /** Load a URL (or return the cached asset). Picks a loader by extension. */
  async load(url: string): Promise<unknown> {
    if (this.cache.has(url)) return this.cache.get(url);
    const ext = extensionOf(url);
    const loader = this.loaders.get(ext) ?? defaultLoaderFor(ext);
    if (!loader) throw new Error(`No asset loader registered for ".${ext}" (url: ${url})`);
    const asset = await loader(url);
    markManaged(asset);
    this.cache.set(url, asset);
    return asset;
  }

  /**
   * Apply a loaded asset to a target as soon as it's available: **synchronously**
   * if already cached (the `loadSceneAsync` path), otherwise **streamed in** when
   * its background load finishes (the synchronous `loadScene` path — the texture/
   * model pops in on arrival). A failed background load is ignored. No-op for an
   * empty URL.
   */
  resolve<T = unknown>(url: string, apply: (asset: T) => void): void {
    if (!url) return;
    const cached = this.cache.get(url);
    if (cached !== undefined) {
      apply(cached as T);
      return;
    }
    void this.load(url)
      .then((asset) => apply(asset as T))
      .catch(() => {});
  }

  /** Load many URLs in parallel, skipping any already cached. */
  async loadAll(urls: Iterable<string>): Promise<void> {
    const pending = [...new Set(urls)].filter((u) => !this.cache.has(u));
    await Promise.all(pending.map((u) => this.load(u)));
  }

  /** True if `resource` (texture/geometry/material) is owned by the cache. */
  static isManaged(resource: { userData?: Record<string, unknown> } | null | undefined): boolean {
    return resource?.userData?.[MANAGED] === true;
  }

  /** Free every cached asset's GPU resources and empty the cache. */
  dispose(): void {
    for (const asset of this.cache.values()) disposeAsset(asset);
    this.cache.clear();
  }
}

/** Tag a loaded asset (and a glTF's shared geometry/materials/textures) as cache-owned. */
function markManaged(asset: unknown): void {
  if (isTexture(asset)) {
    tag(asset);
    return;
  }
  const scene = (asset as { scene?: Object3D }).scene;
  if (scene) {
    scene.traverse((object) => {
      const mesh = object as Object3D & { geometry?: Taggable; material?: unknown };
      tag(mesh.geometry);
      for (const m of materialsOf(mesh.material)) {
        tag(m);
        for (const t of texturesOf(m)) tag(t);
      }
    });
  }
}

function disposeAsset(asset: unknown): void {
  if (isTexture(asset)) {
    asset.dispose();
    return;
  }
  const scene = (asset as { scene?: Object3D }).scene;
  if (scene) {
    scene.traverse((object) => {
      const mesh = object as Object3D & { geometry?: { dispose?(): void }; material?: unknown };
      mesh.geometry?.dispose?.();
      for (const m of materialsOf(mesh.material)) {
        for (const t of texturesOf(m)) t.dispose();
        (m as { dispose?(): void }).dispose?.();
      }
    });
  }
}

// ---- helpers ----------------------------------------------------------------

type Taggable = { userData?: Record<string, unknown> } | undefined;

function tag(resource: unknown): void {
  if (resource && typeof resource === 'object') {
    const r = resource as { userData?: Record<string, unknown> };
    (r.userData ??= {})[MANAGED] = true;
  }
}

function isTexture(value: unknown): value is { dispose(): void; userData?: Record<string, unknown> } {
  return typeof value === 'object' && value !== null && (value as { isTexture?: boolean }).isTexture === true;
}

function materialsOf(material: unknown): unknown[] {
  return material ? (Array.isArray(material) ? material : [material]) : [];
}

/** The textures held by a material (map-style fields + ShaderMaterial uniforms). */
function texturesOf(material: unknown): { dispose(): void; userData?: Record<string, unknown> }[] {
  const out: { dispose(): void; userData?: Record<string, unknown> }[] = [];
  const m = material as Record<string, unknown> & { uniforms?: Record<string, { value?: unknown }> };
  for (const value of Object.values(m)) if (isTexture(value)) out.push(value);
  if (m.uniforms) for (const u of Object.values(m.uniforms)) if (isTexture(u?.value)) out.push(u.value);
  return out;
}

function extensionOf(url: string): string {
  const clean = url.split(/[?#]/)[0] ?? url;
  const dot = clean.lastIndexOf('.');
  return dot === -1 ? '' : clean.slice(dot + 1).toLowerCase();
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif']);
const MODEL_EXT = new Set(['glb', 'gltf']);
const AUDIO_EXT = new Set(['mp3', 'ogg', 'wav', 'm4a', 'aac', 'flac', 'webm']);

/** Built-in loaders: TextureLoader for images, AudioLoader for sound, lazy GLTFLoader for models. */
function defaultLoaderFor(ext: string): AssetLoader | undefined {
  if (IMAGE_EXT.has(ext)) return (url) => new TextureLoader().loadAsync(url);
  if (AUDIO_EXT.has(ext)) return (url) => new AudioLoader().loadAsync(url);
  if (MODEL_EXT.has(ext)) {
    return async (url) => {
      // Dynamic import so three's glTF addon never ships unless a scene uses a model.
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      return new GLTFLoader().loadAsync(url);
    };
  }
  return undefined;
}
