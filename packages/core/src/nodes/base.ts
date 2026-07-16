import type { Object3D } from 'three';
import type { AttachContext } from '../registry/NodeRegistry.js';

/**
 * Base classes for the two tag kinds that live in the scene tree — the factory
 * counterpart to `Component`. A tag is a class: its XML attributes are
 * `@property` fields, a class decorator (`@node`/`@attachment`) declares its kind
 * and registers it, and the body reads the fields with full typing.
 *
 *   @node({ name: 'Mesh', description: 'A renderable object', children: { … } })
 *   class MeshNode extends Object3DNode { build() { return new Mesh(); } }
 *
 *   @attachment({ name: 'BoxGeometry', description: 'Box geometry', target: Mesh, group: 'geometry', required: true })
 *   class BoxGeometry extends Attachment<Mesh> {
 *     @property({ type: ValueType.Float, description: 'Size along X' }) width = 1;
 *     attach(ctx) { ctx.node.geometry = new BoxGeometry(this.width); }
 *   }
 *
 * A `description` is mandatory on every `@node`/`@attachment`/`@component`/`@property`.
 */

/** A scene-graph node (Object3D family + the Scene root). Builds the bare object. */
export abstract class Object3DNode {
  abstract build(): Object3D;
}

/**
 * A leaf that attaches to and configures a node — geometry/material on a mesh,
 * fog/background on the scene. `TNode` types the host: `Attachment<Mesh>` gives
 * `ctx.node` typed as `Mesh`. An attachment may cache the resource it builds on
 * `this`, so the compiler's content-dedup (one def instance shared across nodes)
 * yields one shared geometry/material.
 */
export abstract class Attachment<TNode extends Object3D = Object3D> {
  abstract attach(ctx: AttachContext<TNode>): void;
}
