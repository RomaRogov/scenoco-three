// Internal bridge exports for build-time tooling packages.
// Not intended as the primary runtime API surface.

export {
  Registry,
  isScalarType,
  isArrayType,
  elementType,
  type ComponentCtor,
  type PropertyMeta,
  type PropType,
  type PropertyType,
} from './core/Registry.js';

export { enumOf, isEnumType, getEnum, allEnums, unregisterEnum, type EnumDef } from './core/EnumRegistry.js';

export {
  getNodeDef,
  nodeTags,
  allNodeDefs,
  isSpatial,
  unregisterNode,
  getAttachmentDef,
  attachmentTags,
  allAttachmentDefs,
  attachmentsForNode,
  attachmentAcceptsNode,
  unregisterAttachment,
  allSystemDefs,
  TRANSFORM_ATTRS,
  type NodeDef,
  type NodeAttr,
  type NodeKind,
  type ChildRules,
  type AttachmentDef,
  type AttachTarget,
  type AttachClass,
  type AttachContext,
  type SystemDef,
} from './dsl/nodes.js';

export { builtinNodeModules, builtinNodeModule } from './nodes/manifest.js';

export {
  BUNDLE_VERSION,
  ComponentFlag,
  NodeFlag,
  type Bundle,
  type BundleAsset,
  type BundleComponent,
  type BundleKind,
  type BundleNode,
  type BundleTag,
  type BundleValue,
} from './dsl/bundle-format.js';

export {
  componentPropEntries,
  nodeAttrEntries,
  attachmentAttrEntries,
  popcount,
  valueEquals,
} from './dsl/bundle-shared.js';

export type {
  CompiledScene,
  CompiledNode,
  CompiledComponent,
  CompiledAsset,
  CompiledRef,
  CompiledValue,
  CompiledTransform,
} from './dsl/compiled.js';

export type { CompiledScalar, ScalarType } from './dsl/types.js';
