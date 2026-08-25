import { ACESFilmicToneMapping, type ToneMapping as ToneMappingCurve, type WebGLRenderer } from 'three';
import { Effect } from '@scenoco-three/core';

/**
 * The tone curve applied to the rendered image.
 *
 * Worth adding the moment a light is brighter than 1: without it everything above white clips
 * flat, and the bright end of a neon-lit scene turns into featureless paper.
 *
 * ```xml
 * <ToneMapping curve="ACESFilmicToneMapping" exposure="1.05" />
 * ```
 *
 * `curve` takes three.js's own constants, because the field is declared with three.js's own
 * type — the vocabulary is not a list in this package.
 */
export class ToneMapping extends Effect {
  curve: ToneMappingCurve = ACESFilmicToneMapping;

  /** 1 is neutral; below 1 darkens, above 1 lifts. */
  exposure = 1;

  override apply({ renderer }: { renderer: WebGLRenderer }): void {
    renderer.toneMapping = this.curve;
    renderer.toneMappingExposure = this.exposure;
  }
}
