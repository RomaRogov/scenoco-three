import type { Pass } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { Effect } from '@scenoco-three/core';

/**
 * Darkened corners — three.js's `VignetteShader`.
 *
 * ```xml
 * <Vignette darkness="1.1" />
 * ```
 *
 * The cheapest way to pull the eye to the middle of the screen, and on a dark game it hides the
 * edge of the playfield rather than ending it with a hard line.
 */
export class Vignette extends Effect {
  /** How far from the centre the darkening starts. Larger is a tighter circle. */
  offset = 1;
  /** How dark the corners get. */
  darkness = 1;

  override createPass(): Pass {
    const pass = new ShaderPass(VignetteShader);
    pass.uniforms.offset!.value = this.offset;
    pass.uniforms.darkness!.value = this.darkness;
    return pass;
  }
}
