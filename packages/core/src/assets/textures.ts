import { Texture, TextureLoader } from 'three';
import { trackLoad } from './Asset.js';
import { shared } from './shared.js';

/**
 * The texture for an image URL — one per URL, shared by everything that asks.
 *
 * Usable at once: the image fills in when it arrives, so a material can be built with it at
 * module scope. Pass it to `loadAssets` to wait for the pixels.
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
 * The `Texture`, with its image on the way. With no DOM it is empty rather than a throw: this
 * runs at module scope, where throwing would take down every test and server render.
 */
function load(url: string): Texture {
  if (typeof document === 'undefined') return new Texture();

  const loader = (sharedLoader ??= new TextureLoader());
  const texture = loader.load(url, undefined, undefined, (error) => {
    console.error(`[scenoco] failed to load texture "${url}":`, error);
  });
  // A second request, not a hook into the first — three.js's callback and promise forms are
  // separate paths to the same load. It resolves from the browser's cache.
  trackLoad(texture, loader.loadAsync(url));
  return texture;
}

/**
 * The sampler settings a texture accepts — three.js's own.
 *
 * Not `image`, `source` or `mipmaps`: those are the loaded data, and setting them would contradict
 * the file.
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
  // Copied, not assigned: the three vectors are live objects three.js hands out once per
  // texture, and replacing one detaches it from the texture's own transform.
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
