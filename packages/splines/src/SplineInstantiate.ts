import { Euler, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { Behaviour, destroy, instantiate, type Model, type Prefab as PrefabFn } from '@scenoco-three/core';
import { containerFor, type SplineContainer } from './SplineContainer.js';
import { FrameReader } from './frames.js';

type Prefab = PrefabFn | Model;

/**
 * Places copies of prefabs along a spline, as children of its node — Unity's `SplineInstantiate`:
 * barriers along a track, lamps along a road, fence posts.
 *
 * ```tsx
 * <Group>
 *   <SplineInstantiate container={track} itemsToInstantiate={[Barrier, Cone]} method="spacingDistance" spacing={6} positionOffset={[5, 0, 0]} />
 * </Group>
 * ```
 *
 * The items take turns, in order. Offsets are in the spline's frame: `x` to the right of it, `y` up
 * from it, `z` along it.
 */
export class SplineInstantiate extends Behaviour {
  /** The spline: a ref to the node holding the `SplineContainer`. Left out, the one on this node. */
  container: SplineContainer | Object3D | null = null;
  /** The prefabs to place, taking turns. */
  itemsToInstantiate: Prefab[] = [];
  /** `'instanceCount'`: `instanceCount` copies spread over the length. `'spacingDistance'`: one every `spacing` world units. */
  method: 'instanceCount' | 'spacingDistance' = 'spacingDistance';
  instanceCount = 10;
  spacing = 2;
  positionOffset = new Vector3();
  rotationOffset = new Euler();
  /** `'splineElement'`: each copy faces along the spline, its up the spline's up. `'world'`: unrotated. */
  alignTo: 'splineElement' | 'world' = 'splineElement';

  private placed: Object3D[] = [];

  /** The copies it placed, in order along the spline. */
  get instances(): readonly Object3D[] {
    return this.placed;
  }

  override start(): void {
    this.rebuild();
    this.listen(containerFor(this, this.container, 'SplineInstantiate').changed, () => this.rebuild());
  }

  /** A setting changed in the editor, or the spline's node moved: built again. */
  override onValidate(): void {
    this.rebuild();
  }

  /** Place the copies again, after the spline or a setting changed: the old ones are destroyed. */
  rebuild(): void {
    for (const node of this.placed) destroy(node);
    this.placed = [];
    if (this.itemsToInstantiate.length === 0) return;

    const container = containerFor(this, this.container, 'SplineInstantiate');
    const reader = new FrameReader(container, this.node);
    const closed = container.closed;
    const count =
      this.method === 'instanceCount'
        ? Math.max(0, Math.round(this.instanceCount))
        : Math.floor(reader.length / Math.max(1e-3, this.spacing)) + (closed ? 0 : 1);
    // On a closed spline the last copy would sit on the first: spread over one gap fewer's worth.
    const steps = closed ? count : Math.max(1, count - 1);

    const basis = new Matrix4();
    const turn = new Quaternion().setFromEuler(this.rotationOffset);
    let frame = reader.at(0);
    for (let i = 0; i < count; i++) {
      frame = reader.at(count === 1 ? 0 : i / steps, frame);
      // The copy's own axes: +Z along the spline, +Y up, +X to the left — glTF's and Unity's facing.
      const left = frame.right.clone().negate();
      basis.makeBasis(left, frame.up, frame.forward);
      const position = frame.position.clone()
        .addScaledVector(frame.right, this.positionOffset.x)
        .addScaledVector(frame.up, this.positionOffset.y)
        .addScaledVector(frame.forward, this.positionOffset.z);
      const quaternion = this.alignTo === 'world' ? turn.clone() : new Quaternion().setFromRotationMatrix(basis).multiply(turn);
      const item = this.itemsToInstantiate[i % this.itemsToInstantiate.length]!;
      this.placed.push(instantiate(item, { parent: this.node, position: [position.x, position.y, position.z], quaternion }));
    }
  }
}
