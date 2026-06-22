import { BoxShape, CircleShape, type FixtureOpt, type Shape } from 'planck';
import type { Object3D } from 'three';
import { Component, component, enumOf, property } from '@scenoco-three/core';

/** Collision shape — `auto` reads the host mesh geometry. */
export const Collider2DShape = enumOf('Collider2DShape', { auto: 'auto', box: 'box', circle: 'circle' });

/**
 * A 2D collision shape on the node. The `Physics2DSystem` attaches it to the
 * node's `<RigidBody2D>` when it builds that body (no manual registration).
 *
 * `shape="auto"` reads the host mesh's geometry: a `<BoxGeometry>` becomes a box
 * (XY half-extents from width/height), a `<SphereGeometry>` a circle. Set
 * `isSensor="true"` for a trigger — it reports overlaps (`onTriggerEnter2D`) but
 * generates no collision response.
 */
@component({ name: 'Collider2D', description: 'A 2D collision shape (planck); the Physics2DSystem attaches it to the node’s RigidBody2D' })
export class Collider2D extends Component {
  @property({ type: Collider2DShape, default: 'auto', description: 'Collision shape (auto reads the mesh geometry)' })
  shape = 'auto';

  @property({ type: 'vec2', default: [0.5, 0.5], description: 'Box half-extents (shape="box")' })
  halfExtents = [0.5, 0.5];

  @property({ type: 'float', default: 0.5, description: 'Radius (shape="circle")' })
  radius = 0.5;

  @property({ type: 'float', default: 1, description: 'Density (kg/m²); 0 for static' })
  density = 1;

  @property({ type: 'float', default: 0.3, description: 'Friction 0..1' })
  friction = 0.3;

  @property({ type: 'float', default: 0, description: 'Restitution (bounciness) 0..1' })
  restitution = 0;

  @property({ type: 'bool', default: false, description: 'A trigger: reports overlaps, no collision response' })
  isSensor = false;

  /** The planck shape for this collider, resolving `auto` from the host geometry. */
  toShape(): Shape {
    switch (this.shape) {
      case 'box': {
        const [hx, hy] = this.halfExtents;
        return new BoxShape(hx!, hy!);
      }
      case 'circle':
        return new CircleShape(this.radius);
      default:
        return this.autoShape();
    }
  }

  /** Fixture material/flags for `body.createFixture(shape, opt)`. */
  fixtureOpt(): FixtureOpt {
    return {
      density: this.density,
      friction: this.friction,
      restitution: this.restitution,
      isSensor: this.isSensor,
    };
  }

  /** Derive a shape from the host mesh's geometry parameters. */
  private autoShape(): Shape {
    const geom = (this.node as Object3D & { geometry?: { type?: string; parameters?: Record<string, number> } }).geometry;
    const p = geom?.parameters;
    if (geom && p) {
      switch (geom.type) {
        case 'BoxGeometry':
        case 'PlaneGeometry':
          return new BoxShape((p.width ?? 1) / 2, (p.height ?? 1) / 2);
        case 'SphereGeometry':
        case 'CircleGeometry':
          return new CircleShape(p.radius ?? 0.5);
      }
    }
    return new BoxShape(0.5, 0.5); // fallback: unit box
  }
}
