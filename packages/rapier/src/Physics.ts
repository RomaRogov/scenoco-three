import { Attachment, attachment, property, ValueType } from '@scenoco-three/core';

/**
 * Scene-level physics config: `<Physics gravity="0 -9.81 0" />` inside `<Scene>`.
 * It's a pure config attachment — the `PhysicsSystem` (auto-run while the scene
 * has rigid bodies) reads its `gravity` via `engine.findAttachment(Physics)`.
 * Requires `await initRapier()` before `engine.loadScene()`.
 */
@attachment({ name: 'Physics', target: 'Scene', group: 'physics', description: 'Scene physics config (gravity)' })
export class Physics extends Attachment {
  @property({ type: ValueType.Vec3, description: 'Gravity vector' })
  gravity = [0, -9.81, 0];

  // Config only: the value is read by PhysicsSystem.onAttach; nothing to apply.
  attach(): void {}
}
