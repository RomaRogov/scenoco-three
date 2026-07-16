// Internal bridge exports for build-time tooling packages.
// Not intended as the primary runtime API surface.

export {
  Registry,
  ValueType,
  isScalarType,
  isArrayType,
  elementType,
  type ComponentCtor,
  type PropertyMeta,
  type PropType,
  type PropertyType,
} from './registry/Registry.js';

export { enumOf, isEnumType, getEnum, allEnums, unregisterEnum, type EnumDef } from './registry/EnumRegistry.js';

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
} from './registry/NodeRegistry.js';

export { builtinNodeModules, builtinNodeModule } from './nodes/manifest.js';
export { getSrcCompiler, type ParsedElement, type SrcCompiler } from './scene/src-compiler.js';

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
} from './scene/bundle-format.js';

export {
  componentPropEntries,
  nodeAttrEntries,
  attachmentAttrEntries,
  popcount,
  valueEquals,
} from './scene/bundle-shared.js';

export type {
  CompiledScene,
  CompiledNode,
  CompiledComponent,
  CompiledAsset,
  CompiledUniform,
  CompiledRef,
  CompiledValue,
  CompiledTransform,
} from './scene/compiled.js';
export { UNIFORM_TYPES, isUniformType, type UniformTypeName } from './scene/uniforms.js';

export type { CompiledScalar, ScalarType } from './scene/types.js';
