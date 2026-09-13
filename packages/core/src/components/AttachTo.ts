import type { Object3D } from 'three';
import { Component } from '../runtime/Component.js';

/**
 * Attach this node to a bone inside another model — a sword in a hand, a hat on a head.
 *
 * The node is **reparented** onto the bone and keeps its local transform, so its authored
 * position becomes the grip offset and the skeleton carries it from then on: nothing to copy
 * per frame. The bone is named by the string the artist gave it, since a node inside a loaded
 * model is not addressable any other way.
 */
export class AttachTo extends Component {
  /** The model to look inside. Required: two skeletons in a scene share bone names. */
  target!: Object3D;

  /** The bone's name, as the model has it — `mixamorig:RightHand`, `hand.R`, `Bone.012`. */
  bone = '';

  /** The bone it attached to, or null when it could not find one. */
  attached: Object3D | null = null;

  override start(): void {
    const bone = this.find();
    if (!bone) return;
    this.attached = bone;
    // `add` moves it and leaves the local transform alone, which makes it an offset.
    bone.add(this.object3D);
  }

  private find(): Object3D | undefined {
    if (this.bone === '') {
      console.error(`[scenoco] AttachTo on "${this.name()}" has no bone= to attach to.`);
      return undefined;
    }
    const found = this.target.getObjectByName(this.bone);
    if (found) return found;

    // A wrong name is otherwise a sword lying at the origin with nothing to say why.
    const names: string[] = [];
    this.target.traverse((node) => {
      if (node.name && names.length < 40) names.push(node.name);
    });
    console.error(
      `[scenoco] AttachTo on "${this.name()}": "${this.target.name || 'the target'}" has no node ` +
        `named "${this.bone}". It has: ${names.join(', ') || '(nothing named)'}.`,
    );
    return undefined;
  }

  private name(): string {
    return this.object3D.name || '(unnamed)';
  }
}
