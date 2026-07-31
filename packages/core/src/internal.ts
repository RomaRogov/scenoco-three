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

// The vector text grammar. Declared in core (not the compiler) because the
// editor's browser-side document model parses attribute text too — see the
// module header for why one declaration matters here specifically.
export {
  VEC_AXES,
  vecFormatFor,
  VEC2_FORMAT,
  VEC3_FORMAT,
  EULER_FORMAT,
  parseVecText,
  serializeVecText,
  serializeVecPositional,
  vecMessage,
  type VecFormat,
  type VecParse,
} from './scene/vec-format.js';

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
  buildMask,
  maskHas,
  popcount,
  valueEquals,
  type BundleMask,
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
