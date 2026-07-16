import { Attachment, attachment, property, ValueType } from '@scenoco-three/core';

/**
 * Scene-level physics config — **inert in this detection-only system**, provided
 * only so a scene authored for `@scenoco-three/rapier` (`<Physics gravity=…>`)
 * drops in unchanged. There is no gravity or simulation here.
 */
@attachment({ name: 'Physics', target: 'Scene', group: 'physics', description: 'Scene physics config — inert in detection-only mode (rapier-compatible tag)' })
export class Physics extends Attachment {
  @property({ type: ValueType.Vec3, default: [0, -9.81, 0], description: 'Gravity vector (inert here)' })
  gravity = [0, -9.81, 0];

  attach(): void {}
}
