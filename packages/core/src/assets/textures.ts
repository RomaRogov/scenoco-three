import { Texture, TextureLoader } from 'three';
import { trackLoad } from './Asset.js';

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

  const texture = load(url);
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
  // What `loadAssets` waits for is this texture's own load, ending when its image is set. A second
  // request of the same URL, awaited instead, could finish first — a slow or remote file then
  // reached the scene with no image yet.
  let texture!: Texture;
  const loaded = new Promise<void>((done, fail) => {
    texture = loader.load(url, () => done(), undefined, (error) => {
      console.error(`[scenoco] failed to load texture "${url}":`, error);
      fail(error);
    });
  });
  trackLoad(texture, loaded);
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

/** @internal drop the URL cache. For tests and HMR. */
export function clearTextureCache(): void {
  cache.clear();
}
