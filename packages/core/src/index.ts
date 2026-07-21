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
  executeInEditor,
  type ComponentOptions,
  type NodeOptions,
  type AttachmentOptions,
  type SystemOptions,
} from './registry/decorators.js';
export { Object3DNode, Attachment } from './nodes/base.js';

// Tag registry — built-in tags self-register on import; projects add their own
// the same way (the extensible counterpart to @component).
export {
  getNodeDef,
  nodeTags,
  allNodeDefs,
  registerNode,
  unregisterNode,
  getAttachmentDef,
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

