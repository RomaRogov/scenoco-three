import type { CompiledScalar } from './types.js';

/**
 * Compiled scene: a flat, indexed structure (Cocos Creator scene-format style).
 * All cross-references are integer indices, so the runtime instantiates with no
 * name lookups or string parsing. This is the ergonomic intermediate the
 * compiler emits and the bundle decoder reconstructs.
 *
 * These are **pure types with no runtime imports**, so the runtime can use them
 * without pulling in the XML parser/validator (which live in compile.ts).
 */
export interface CompiledScene {
  /** Index of the root <Scene> node (always 0). */
  root: number;
  nodes: CompiledNode[];
  /** Content-addressed pool of attachments (geometry/material/fog/…), shared by index. */
  attachments: CompiledAsset[];
  components: CompiledComponent[];
  /**
   * Embedded prefab subtrees referenced by `@property({ type: 'prefab' })`
   * props, one self-contained CompiledScene each (resolved + compiled at build
   * time). A prefab prop stores `{ prefab: i }`; the runtime hands the component
   * a PrefabRef bound to `prefabs[i]`. Present only when the scene uses one.
   */
  prefabs?: CompiledScene[];
}

/** A resolved reference: an index into nodes[], components[], or prefabs[]. */
export type CompiledRef = { node: number } | { component: number } | { prefab: number };
export type CompiledValue = CompiledScalar | CompiledRef;

export interface CompiledTransform {
  position: number[];
  rotation: number[]; // radians
  scale: number[];
  visible: boolean;
}

export interface CompiledNode {
  tag: string;
  /** Author-assigned id (maps to Object3D.name at runtime). */
  id?: string;
  parent: number; // -1 for root
  children: number[];
  transform: CompiledTransform;
  /** Type-specific scalar attrs (e.g. light color/intensity, camera fov). */
  attrs: Record<string, CompiledScalar>;
  /** Indices into the scene's attachments[] pool (geometry/material/settings/…). */
  attachments: number[];
  components: number[]; // indices into components[]
}

export interface CompiledAsset {
  tag: string;
  attrs: Record<string, CompiledScalar>;
}

export interface CompiledComponent {
  type: string;
  id?: string;
  node: number; // owning node index
  /** Only explicitly-set props; omitted props keep the component's field defaults. */
  props: Record<string, CompiledValue>;
}
