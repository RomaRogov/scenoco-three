import { Vector3, type Object3D } from 'three';
import { Component, component, enumOf, property, ValueType } from '@scenoco-three/core';

/** The joint types this package supports (a useful subset of Rapier's). */
export const JointKind = enumOf('JointKind', ['fixed', 'revolute', 'spherical', 'prismatic', 'spring']);

/**
 * Connects this node's `<RigidBody>` to another body's with a physics joint
 * (Rapier impulse joint). `connectedBody` references the other node; the anchors
 * are local offsets on each body, and `axis` is the hinge/slide axis for
 * revolute/prismatic joints.
 *
 *   <Mesh id="hinge"><BoxGeometry /><Components><RigidBody kind="fixed" /><BoxCollider /></Components></Mesh>
 *   <Mesh id="door" position="1 0 0">
 *     <BoxGeometry width="2" /><MeshStandardMaterial />
 *     <Components>
 *       <RigidBody /><BoxCollider halfExtents="1 0.5 0.1" />
 *       <Joint kind="revolute" connectedBody="#hinge" anchor="-1 0 0" connectedAnchor="0 0 0" axis="0 1 0" />
 *     </Components>
 *   </Mesh>
 */
@component({ name: 'Joint', description: 'A physics joint to another body (fixed/revolute/spherical/prismatic/spring).' })
export class Joint extends Component {
  @property({ type: JointKind, default: 'fixed', description: 'Joint type' })
  kind = 'fixed';
  @property({ type: ValueType.Node, description: 'The other body to connect to (a node with a RigidBody)' })
  connectedBody: Object3D | null = null;
  @property({ type: ValueType.Vec3, default: [0, 0, 0], description: 'Local anchor on this body' })
  anchor = new Vector3();
  @property({ type: ValueType.Vec3, default: [0, 0, 0], description: 'Local anchor on the connected body' })
  connectedAnchor = new Vector3();
  @property({ type: ValueType.Vec3, default: [0, 1, 0], description: 'Hinge/slide axis (revolute, prismatic)' })
  axis = new Vector3(0, 1, 0);
  @property({ type: ValueType.Float, default: 1, description: 'Spring stiffness (spring joint)' })
  stiffness = 1;
  @property({ type: ValueType.Float, default: 0.5, description: 'Spring damping (spring joint)' })
  damping = 0.5;
  @property({ type: ValueType.Float, default: 0, description: 'Spring rest length (spring joint)' })
  restLength = 0;
}
