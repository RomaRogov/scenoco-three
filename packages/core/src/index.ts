// `@scenoco-three/core` — the runtime entry point. Contains no XML parser,
// validator, or compiler: it loads pre-built bundles only.

export {
  Engine,
  type EngineOptions,
  type SceneGraph,
  type PreloadProvider,
  type RaycastOptions,
  type PointerEventData,
} from './runtime/Engine.js';
export { Component } from './runtime/Component.js';
export { System } from './runtime/System.js';
export {
  InputManager,
  type KeyCode,
  type GamepadButton,
  type GamepadState,
} from './subsystems/Input.js';
export {
  Registry,
  ValueType,
  isScalarType,
  isArrayType,
  elementType,
  type PropType,
  type PropertyType,
  type PropertyMeta,
  type PropertyInput,
  type CompiledDefault,
  type ComponentMeta,
  type ComponentCtor,
  type RegisteredComponent,
} from './registry/Registry.js';
export { enumOf, isEnumType, getEnum, allEnums, type EnumDef } from './registry/EnumRegistry.js';
export { AssetCache, type AssetKind, type AssetLoader } from './assets/AssetCache.js';
export { collectAssetRefs, type AssetRef } from './scene/asset-refs.js';

// One authoring idiom: @property fields + a class decorator per role.
export {
  component,
  property,
  node,
  attachment,
  system,
  target,
  executeInEditor,
  type ComponentOptions,
  type NodeOptions,
  type AttachmentOptions,
  type SystemOptions,
} from './registry/decorators.js';
export { Object3DNode, Attachment } from './nodes/base.js';
// The inverse of `attach` — lets tooling remove an attachment, not just overwrite it.
export { detachAttachment } from './nodes/detach.js';

// Tag registry — built-in tags self-register on import; projects add their own
// the same way (the extensible counterpart to @component).
export {
  getNodeDef,
  // The shared transform attribute metadata (type + default + description). Public
  // so tooling — the editor inspector, docs — can describe `position`/`eulerAngles`/
  // `scale`/`visible` from the registry instead of keeping a parallel copy.
  TRANSFORM_ATTRS,
  nodeTags,
  allNodeDefs,
  registerNode,
  unregisterNode,
  getAttachmentDef,
  // Which attachments a node accepts, subclass-aware. Public so tooling — the
  // editor's add-attachment selector, the XSD — can offer exactly the valid set.
  attachmentsForNode,
  componentAcceptsNode,
  attachmentTags,
  allAttachmentDefs,
  registerAttachment,
  unregisterAttachment,
  type NodeDef,
  type NodeAttr,
  type NodeKind,
  type ChildRules,
  type AttachmentDef,
  type AttachTarget,
  type AttachContext,
} from './registry/NodeRegistry.js';

// Stable runtime API: a `@property({ type: ValueType.Prefab })` field receives a PrefabAsset;
// spawning it (or engine.instantiate) yields a PrefabInstance root.
export { PrefabAsset, type SpawnOptions, type SpawnFn, type Vec3Input, type RotationInput } from './scene/PrefabAsset.js';
export { PrefabInstance } from './scene/PrefabInstance.js';

// ── Advanced / tooling surface ──────────────────────────────────────────────
// The compiled-bundle format and the low-level instantiate/deserialize entry
// points. Consumed by the compiler, the editor, and bundle round-trip tests;
// game code rarely touches these. Their shape tracks the compiler and may change
// with the bundle wire format (see `BUNDLE_VERSION`) — treat as less stable than
// the runtime API above.
export { deserializeBundle } from './scene/deserialize.js';
export {
  registerSrcCompiler,
  getSrcCompiler,
  type ParsedElement,
  type SrcCompiler,
  type SrcCompileResult,
  type SrcDiagnostic,
} from './scene/src-compiler.js';
export {
  BUNDLE_VERSION,
  bundleKind,
  type Bundle,
  type BundleAsset,
  type BundleKind,
} from './scene/bundle-format.js';
export { instantiateScene, type InstantiatedScene } from './scene/instantiate.js';
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
export { UNIFORM_TYPES, UniformType, isUniformType, type UniformTypeName } from './scene/uniforms.js';

// The vector attribute text grammar ("y: 1.5; z: -3", or positional "0 1.5 -3").
// Public so a tool that reads or writes scene text — the editor's document model,
// a project's own codemod — shares the compiler's exact parse instead of
// hand-rolling a splitter that drifts from it.
export {
  VEC_AXES,
  vecFormatFor,
  VEC2_FORMAT,
  VEC3_FORMAT,
  EULER_FORMAT,
  parseVecText,
  serializeVecText,
  serializeVecPositional,
  type VecFormat,
  type VecParse,
} from './scene/vec-format.js';

