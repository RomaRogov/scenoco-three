import { Color, Mesh, MeshStandardMaterial } from 'three';
import { Component, component, property, target, ValueType } from '@scenoco-three/core';

/**
 * A component that genuinely depends on its host type — it recolours the host's
 * material, which only a Mesh has. It declares both halves of the pair:
 *
 *  - `@target(Mesh)` so the registry (and the editor's picker) can filter it
 *  - `Component<Mesh>` so `this.node.material` type-checks
 *
 * The decorator sits above `@component`, where Unity puts its attributes.
 */
@target(Mesh)
@component({ name: 'MeshTinter', description: 'Tints the host mesh material' })
export class MeshTinter extends Component<Mesh> {
  @property({ type: ValueType.Color, description: 'Tint applied to the host material' })
  tint = 0xffffff;

  override start(): void {
    const material = this.node.material as MeshStandardMaterial;
    material.color = new Color(this.tint);
  }
}
