import { PCFSoftShadowMap, type ShadowMapType, type WebGLRenderer } from 'three';
import { Effect } from '@scenoco-three/core';

/**
 * Whether lights that cast shadows actually do — three.js's `renderer.shadowMap`.
 *
 * ```xml
 * <Shadows type="PCFSoftShadowMap" />
 * ```
 *
 * Off unless a document says otherwise, as in three.js. A light still needs `castShadow` and a
 * surface `receiveShadow`; this is the switch that makes either mean anything.
 */
export class Shadows extends Effect {
  enabled = true;
  type: ShadowMapType = PCFSoftShadowMap;

  override apply({ renderer }: { renderer: WebGLRenderer }): void {
    renderer.shadowMap.enabled = this.enabled;
    renderer.shadowMap.type = this.type;
  }
}
