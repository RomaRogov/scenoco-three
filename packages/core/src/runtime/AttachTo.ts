import type { Object3D } from 'three';
import { Component } from './Component.js';

/**
 * Attach this node to a bone inside another model — a sword in a hand, a hat on a head.
 *
 * ```xml
 * <Group id="hero">
 *   <Prefab src="../models/hero.glb" />
 *   <Components><Animator clip="Run" /></Components>
 * </Group>
 *
 * <Prefab src="../models/sword.glb" position="x: 0.02; z: 0.1" eulerAngles="x: 90">
 *   <Components>
 *     <AttachTo target="#hero" bone="mixamorig:RightHand" />
 *   </Components>
 * </Prefab>
 * ```
 *
 * The node is **reparented** onto the bone, keeping its local transform — so whatever the
 * document wrote as `position` and `eulerAngles` becomes the grip offset from the hand, which is
 * how it reads and how you tune it. From then on the skeleton carries it: no per-frame copying,
 * no component to keep in step, nothing to do at all.
 *
 * A bone inside a glTF is an ordinary node in the scene graph, but it is not addressable from a
 * document — `#id` reaches what *this* document declared, and the skeleton came out of a file.
 * So it is named by the string the artist gave it, which is the one thing a document can know
 * about the inside of a model, and a wrong name is reported with the names the model does have.
 */
export class AttachTo extends Component {
  /**
   * The model to look inside. Required: searching the whole scene for a bone name would find a
   * different skeleton the moment there were two of them.
   */
  target!: Object3D;

  /** The bone's name, as the model has it — `mixamorig:RightHand`, `hand.R`, `Bone.012`. */
  bone = '';

  /** The bone it attached to, or null when it could not find one. */
  attached: Object3D | null = null;

  override start(): void {
    const bone = this.find();
    if (!bone) return;
    this.attached = bone;
    // `add` moves it: the old parent lets go, the components come along, and the local transform
    // is left alone, which is what makes it an offset from the bone.
    bone.add(this.object3D);
  }

  private find(): Object3D | undefined {
    if (this.bone === '') {
      console.error(`[scenoco] AttachTo on "${this.name()}" has no bone= to attach to.`);
      return undefined;
    }
    const found = this.target.getObjectByName(this.bone);
    if (found) return found;

    // A wrong bone name is otherwise a sword lying at the origin with nothing to say why, and
    // the names are the artist's, so guessing them is exactly what the message has to help with.
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
