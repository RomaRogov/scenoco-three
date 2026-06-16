import RAPIER from '@dimforge/rapier3d-compat';
import { Component, component, property } from '@scenoco-three/core';

/**
 * A collision shape on the node. The `PhysicsSystem` attaches it to the node's
 * `<RigidBody>` when it builds that body (no manual registration). `shape="auto"`
 * reads the host mesh's geometry parameters — a `<Mesh><SphereGeometry radius=
 * "0.5"/></Mesh>` gets a 0.5 ball for free.
 */
@component({ name: 'Collider', description: 'A Rapier collision shape; the PhysicsSystem attaches it to the node’s RigidBody' })
export class Collider extends Component {
  @property({ type: 'string', default: 'auto', description: 'auto | box | sphere | capsule | cylinder' })
  shape = 'auto';
  @property({ type: 'vec3', default: [0.5, 0.5, 0.5], description: 'Box half-extents (shape="box")' })
  halfExtents = [0.5, 0.5, 0.5];
  @property({ type: 'float', default: 0.5, description: 'Radius (sphere/capsule/cylinder)' }) radius = 0.5;
  @property({ type: 'float', default: 0.5, description: 'Half-height (capsule/cylinder)' }) halfHeight = 0.5;
  @property({ type: 'float', default: 0, description: 'Bounciness 0..1' }) restitution = 0;
  @property({ type: 'float', default: 0.5 }) friction = 0.5;
  @property({ type: 'float', default: 1 }) density = 1;

  /** @internal Build the Rapier collider descriptor with material properties. */
  toDesc(): RAPIER.ColliderDesc {
    return this.shapeDesc()
      .setRestitution(this.restitution)
      .setFriction(this.friction)
      .setDensity(this.density);
  }

  private shapeDesc(): RAPIER.ColliderDesc {
    const [hx, hy, hz] = this.halfExtents;
    switch (this.shape) {
      case 'box':
        return RAPIER.ColliderDesc.cuboid(hx!, hy!, hz!);
      case 'sphere':
        return RAPIER.ColliderDesc.ball(this.radius);
      case 'capsule':
        return RAPIER.ColliderDesc.capsule(this.halfHeight, this.radius);
      case 'cylinder':
        return RAPIER.ColliderDesc.cylinder(this.halfHeight, this.radius);
      default:
        return this.autoDesc();
    }
  }

  /** Derive a collider from the host mesh's geometry parameters. */
  private autoDesc(): RAPIER.ColliderDesc {
    const geom = (this.node as { geometry?: { type?: string; parameters?: Record<string, number> } }).geometry;
    const p = geom?.parameters;
    if (geom && p) {
      switch (geom.type) {
        case 'BoxGeometry':
          return RAPIER.ColliderDesc.cuboid((p.width ?? 1) / 2, (p.height ?? 1) / 2, (p.depth ?? 1) / 2);
        case 'SphereGeometry':
          return RAPIER.ColliderDesc.ball(p.radius ?? 0.5);
        case 'CylinderGeometry':
          return RAPIER.ColliderDesc.cylinder((p.height ?? 1) / 2, p.radiusTop ?? p.radius ?? 0.5);
        case 'PlaneGeometry':
          return RAPIER.ColliderDesc.cuboid((p.width ?? 1) / 2, (p.height ?? 1) / 2, 0.01);
      }
    }
    return RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5); // fallback: unit box
  }
}
