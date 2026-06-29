import { Group, type Object3D } from 'three';
import { Component, Object3DNode, component, enumOf, node, property } from '@scenoco-three/core';

// A native TS **numeric** enum (compiles to { Front:0, …, 0:'Front', … }).
export enum Side {
  Front = 0,
  Back = 1,
  Double = 2,
}
export const SideEnum = enumOf('Side', Side);

// A **string** const map (planck-style native values).
export const BodyKind = enumOf('BodyKind', { Static: 'static', Dynamic: 'dynamic', Kinematic: 'kinematic' });

/** A component exercising both enum value kinds on `@property`. */
@component({ name: 'EnumProbe', description: 'Probe for enum properties (numeric + string).' })
export class EnumProbe extends Component {
  // Defaults are authored as member NAMES; normalized to native values at registration.
  @property({ type: SideEnum, default: 'Front', description: 'Numeric-enum property' })
  side: number = Side.Front;

  @property({ type: BodyKind, default: 'Dynamic', description: 'String-enum property' })
  kind: string = 'dynamic';
}

/** A node tag carrying an enum **attribute** (covers the node-attr path). */
@node({ name: 'EnumNode', description: 'Probe for enum node attributes.' })
export class EnumNode extends Object3DNode {
  @property({ type: SideEnum, default: 'Back', description: 'Enum node attribute' })
  side: number = Side.Back;

  build(): Object3D {
    const g = new Group();
    g.userData.side = this.side; // native value reaches the field
    return g;
  }
}
