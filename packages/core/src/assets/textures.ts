import { Texture, TextureLoader } from 'three';
import { trackLoad } from './Asset.js';
import { shared } from './shared.js';

/**
 * The texture for an image URL — one per URL, shared by everything that asks.
 *
 * A texture needs no load barrier: the `Texture` comes back at once and the image fills in when
 * it arrives, so a material can be built with it at module scope. A scene that would rather not
 * show an untextured first frame passes it to `loadAssets`.
 *
 * ```ts
 * export const brick = shared(new MeshStandardMaterial({
 *   map: sharedTexture(new URL('../textures/brick.png', import.meta.url).href),
 * }));
 * ```
 *
 * Deduplicated by URL: two materials naming one image must not mean two uploads to the GPU.
 */
export function sharedTexture(url: string, settings?: TextureSettings): Texture {
  const existing = cache.get(url);
  if (existing) {
    if (settings) apply(existing, settings);
    return existing;
  }

  const texture = shared(load(url));
  if (settings) apply(texture, settings);
  cache.set(url, texture);
  return texture;
}

/**
 * The `Texture`, with its image on the way.
 *
 * With no DOM there is no image to fetch, so this hands back an empty texture rather than
 * throwing: it is called at *module scope*, where a throw would take down every test and every
 * server render before a line of the scene ran.
 */
function load(url: string): Texture {
  if (typeof document === 'undefined') return new Texture();

  const loader = (sharedLoader ??= new TextureLoader());
  const texture = loader.load(url, undefined, undefined, (error) => {
    console.error(`[scenoco] failed to load texture "${url}":`, error);
  });
  // three.js's callback form and its promise form are two paths to the same load, so this is a
  // second request rather than a hook into the first. It resolves from the browser's cache.
  trackLoad(texture, loader.loadAsync(url));
  return texture;
}

/**
 * The sampler settings a texture accepts — three.js's own, nothing invented.
 *
 * Deliberately not every property on `Texture`: `image`, `source` and `mipmaps` are the loaded
 * data rather than settings, and setting them here would contradict the file.
 */
export interface TextureSettings {
  colorSpace?: Texture['colorSpace'];
  wrapS?: Texture['wrapS'];
  wrapT?: Texture['wrapT'];
  magFilter?: Texture['magFilter'];
  minFilter?: Texture['minFilter'];
  anisotropy?: Texture['anisotropy'];
  flipY?: Texture['flipY'];
  generateMipmaps?: Texture['generateMipmaps'];
  premultiplyAlpha?: Texture['premultiplyAlpha'];
  repeat?: Texture['repeat'];
  offset?: Texture['offset'];
  center?: Texture['center'];
  rotation?: Texture['rotation'];
  name?: Texture['name'];
}

let sharedLoader: TextureLoader | undefined;
const cache = new Map<string, Texture>();

function apply(texture: Texture, settings: TextureSettings): void {
  const { repeat, offset, center, ...rest } = settings;
  // The three vectors are live objects three.js hands out once per texture; replacing one
  // outright would detach the texture from its own transform.
  if (repeat) texture.repeat.copy(repeat);
  if (offset) texture.offset.copy(offset);
  if (center) texture.center.copy(center);
  Object.assign(texture, rest);
  texture.needsUpdate = true;
}

/** @internal drop the URL cache. For tests and HMR; `disposeAssets` frees the textures. */
export function clearTextureCache(): void {
  cache.clear();
}
