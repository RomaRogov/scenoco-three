import { Vector2 } from 'three';
import type { Pass } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { Effect } from '@scenoco-three/core';

/**
 * The glow bright pixels bleed into their neighbours — three.js's `UnrealBloomPass`.
 *
 * ```xml
 * <Bloom strength="0.75" radius="0.5" threshold="0.72" />
 * ```
 *
 * On a scene lit with emissive materials it is the difference between coloured plastic and
 * neon, for one pass. It is written as an element rather than a `bloom="0.75"` attribute for
 * the reason every effect is: an element is either there or it is not, so there is no value
 * that means "off" and no neighbouring attribute that silently does nothing.
 *
 * Not `<UnrealBloomPass>` itself, though that is the class underneath: its constructor demands
 * a resolution the engine owns, and its properties include a dozen render targets and uniforms
 * that are not settings. Three fields is the whole of what a document has to say.
 */
export class Bloom extends Effect {
  /** How much the glow adds. */
  strength = 0.6;
  /** How far it spreads, 0–1. */
  radius = 0.4;
  /** Brightness a pixel needs before it glows at all. */
  threshold = 0.85;

  override createPass(): Pass {
    // The resolution is the pass's internal render-target size; `EffectComposer.setSize` gives
    // it the real one as soon as it is added, so this is only a starting point.
    return new UnrealBloomPass(new Vector2(256, 256), this.strength, this.radius, this.threshold);
  }
}
