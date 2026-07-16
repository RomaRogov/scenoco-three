import { Vector2, type Object3D } from 'three';
import { Component, component, enumOf, property, ValueType } from '@scenoco-three/core';

/** The 2D joint types this package supports (planck/Box2D names). */
export const Joint2DKind = enumOf('Joint2DKind', ['revolute', 'distance', 'prismatic', 'weld', 'wheel']);

/**
 * Connects this node's `<RigidBody2D>` to another body's with a Box2D (planck)
 * joint. Mirrors Unity's `Joint2D` surface (`connectedBody` / `anchor` /
 * `connectedAnchor`); anchors are local offsets on each body.
 *
 *   <Mesh id="pivot" position="0 5 0"><BoxGeometry /><Components><RigidBody2D kind="static" /><BoxCollider2D /></Components></Mesh>
 *   <Mesh id="arm" position="2 5 0">
 *     <BoxGeometry width="4" /><MeshStandardMaterial />
 *     <Components>
 *       <RigidBody2D /><BoxCollider2D halfExtents="2 0.2" />
 *       <Joint2D kind="revolute" connectedBody="#pivot" anchor="-2 0" />
 *     </Components>
 *   </Mesh>
 */
@component({ name: 'Joint2D', description: 'A 2D physics joint to another body (revolute/distance/prismatic/weld/wheel).' })
export class Joint2D extends Component {
  @property({ type: Joint2DKind, description: 'Joint type' })
  kind = 'revolute';
  @property({ type: ValueType.Node, description: 'The other body to connect to (a node with a RigidBody2D)' })
  connectedBody: Object3D | null = null;
  @property({ type: ValueType.Vec2, description: 'Local anchor on this body' })
  anchor = new Vector2();
  @property({ type: ValueType.Vec2, description: 'Local anchor on the connected body (distance joint)' })
  connectedAnchor = new Vector2();
  @property({ type: ValueType.Vec2, description: 'Slide/wheel axis (prismatic, wheel)' })
  axis = new Vector2(1, 0);
  @property({ type: ValueType.Float, description: 'Distance-joint spring frequency (Hz; 0 = rigid)' })
  frequency = 0;
  @property({ type: ValueType.Float, description: 'Distance-joint damping ratio' })
  damping = 0.7;
}
