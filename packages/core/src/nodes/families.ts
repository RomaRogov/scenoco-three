import { BufferGeometry, Line, Mesh, MeshStandardMaterial, Points, Scene, Sprite, SpriteMaterial } from 'three';
import { Attachment } from './base.js';

/**
 * Attachment *families*. A family is a base class: everything that extends it
 * competes for the same host property, so the facts they share — which nodes offer
 * it, whether one is mandatory, how to put it back — are declared here once instead
 * of being repeated in every member's decorator (all six geometries carried an
 * identical `target`/`group`/`required` triple).
 *
 * The registry reads these off the constructor at registration. Statics are
 * inherited, so `BoxGeometryNode.target` resolves to `GeometryAttachment.target`
 * with no plumbing, and the *family* — the nearest `Attachment` subclass in the
 * prototype chain — is what `group` is derived from. An attachment that extends
 * `Attachment` directly is simply its own family.
 *
 * Why statics and not the generic: `Attachment<Mesh | Line | Points>` is erased
 * before the registry ever runs — project components are compiled by esbuild, which
 * strips types without a type checker. The static is the runtime shadow of the
 * generic; TypeScript still checks the generic against how `attach()` uses
 * `ctx.node`, so the two cannot drift silently.
 */

/** Nodes that accept a geometry attachment (mesh family + lines + points). */
export const GEOMETRY_TARGETS = [Mesh, Line, Points];
/** Nodes that accept a material attachment (geometry-bearing nodes + sprites). */
export const MATERIAL_TARGETS = [Mesh, Line, Points, Sprite];

/**
 * The host unions, named once so the generic, the `target` list and `reset` all
 * state the same set — they are three views of one fact and must not drift.
 */
export type GeometryHost = Mesh | Line | Points;
export type MaterialHost = Mesh | Line | Points | Sprite;

/** The `geometry` property — exactly one, mandatory. */
export abstract class GeometryAttachment extends Attachment<GeometryHost> {
  static readonly target = GEOMETRY_TARGETS;
  static readonly required = true;
  // Typed as the whole target union, not just `Mesh`: a Line and a Points carry a
  // `geometry` too, and this runs for whichever host actually had the attachment.
  static reset(node: GeometryHost): void {
    node.geometry = new BufferGeometry();
  }
}

/** The `material` property — at most one, optional. */
export abstract class MaterialAttachment extends Attachment<MaterialHost> {
  static readonly target = MATERIAL_TARGETS;
  static reset(node: MaterialHost): void {
    // A Sprite's material is declared *and rendered* as a SpriteMaterial; handing it
    // a mesh material makes it disappear. The other hosts take any Material.
    if (node instanceof Sprite) node.material = new SpriteMaterial();
    else node.material = new MeshStandardMaterial();
  }
}

/** `Scene.fog` — at most one, optional. */
export abstract class FogAttachment extends Attachment<Scene> {
  static readonly target = Scene;
  static reset(node: Scene): void {
    node.fog = null;
  }
}
