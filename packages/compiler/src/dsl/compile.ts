import {
  isScalarType,
  isEnumType,
  isArrayType,
  elementType,
  isSpatial,
  Registry,
  getNodeDef,
  getAttachmentDef,
  getSrcCompiler,
  TRANSFORM_ATTRS,
  type ParsedElement,
  type ComponentCtor,
  type EnumDef,
  type PropType,
  type PropertyMeta,
  type NodeAttr,
  type CompiledAsset,
  type CompiledComponent,
  type CompiledNode,
  type CompiledRef,
  type CompiledScene,
  type CompiledTransform,
  type CompiledUniform,
} from '@scenoco-three/core/internal';
import { parseScene, type SncElement } from './SceneParser.js';
import { isNamespaceAttr, validatePrefab, validateScene } from './Validator.js';
import { expandPrefabs } from './prefab.js';
import { parseArrayLiteral, parseScalarArray, scalarCodec, uniformValue, type CompiledScalar, type ScalarType } from './types.js';
import { glslMatches, parseUniforms } from './shader.js';
import type { NodeOrigin, SceneProvenance } from './provenance.js';
import type { SncDiagnostic } from './diagnostics.js';

// Re-exported so existing `from './compile.js'` imports keep working.
export type {
  CompiledScene,
  CompiledNode,
  CompiledAsset,
  CompiledComponent,
  CompiledTransform,
  CompiledRef,
  CompiledValue,
} from '@scenoco-three/core/internal';

export type CompileResult =
  | { ok: true; scene: CompiledScene; provenance: SceneProvenance }
  | { ok: false; diagnostics: SncDiagnostic[] };

/** A referenced file loaded by a resolver: its canonical path and contents. */
export interface ResolvedFile {
  path: string;
  contents: string;
}

/**
 * Loads a file referenced by `src=` (a material/prefab resource), resolving
 * `request` relative to `referrer`. Returns null if it can't be found. The CLI
 * supplies a filesystem resolver; a browser host can read from a bundled map.
 */
export type ResourceResolver = (request: string, referrer: string) => ResolvedFile | null;

export interface CompileOptions {
  /** Path of the scene being compiled — the referrer for relative `src=` paths. */
  path?: string;
  /** Required for scenes that use `src=` to pull in resource files. */
  resolve?: ResourceResolver;
}

/** Full pipeline: parse → expand prefabs → validate → compile. */
export function compileSceneXml(xml: string, options: CompileOptions = {}): CompileResult {
  const parsed = parseScene(xml);
  if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics };

  // Expand <PrefabInstance src> elements inline before validation, so the
  // validator and compiler see ordinary nodes (the bundle format is prefab-agnostic).
  const expansion: SncDiagnostic[] = [];
  expandPrefabs(parsed.root, options.path ?? '', options, expansion);
  if (expansion.length > 0) return { ok: false, diagnostics: sortDiagnostics(expansion) };

  const diagnostics = validateScene(parsed.root);
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const result = compileTree(parsed.root, options);
  if (result.diagnostics.length > 0) return { ok: false, diagnostics: result.diagnostics };
  return { ok: true, scene: result.scene, provenance: result.provenance };
}

/**
 * Compile a `.prefab.xml` file into a standalone bundle for **dynamic
 * instantiation** at runtime (`engine.instantiate`). The compiled root is the
 * prefab's single node; ids stay local (each runtime instance is its own
 * subtree, and internal references are already resolved to indices).
 */
export function compilePrefabXml(xml: string, options: CompileOptions = {}): CompileResult {
  const parsed = parseScene(xml);
  if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics };

  const expansion: SncDiagnostic[] = [];
  expandPrefabs(parsed.root, options.path ?? '', options, expansion);
  if (expansion.length > 0) return { ok: false, diagnostics: sortDiagnostics(expansion) };

  const diagnostics = validatePrefab(parsed.root);
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const prefabRoot = parsed.root.children.find((c) => isSpatial(c.tag))!;
  const result = compileTree(prefabRoot, options);
  if (result.diagnostics.length > 0) return { ok: false, diagnostics: result.diagnostics };
  return { ok: true, scene: result.scene, provenance: result.provenance };
}

function sortDiagnostics(diagnostics: SncDiagnostic[]): SncDiagnostic[] {
  return [...diagnostics].sort((a, b) => (a.file ?? '').localeCompare(b.file ?? '') || a.line - b.line || a.column - b.column);
}

interface RefTarget {
  ctor: ComponentCtor;
  componentIndex: number;
}

interface PendingRef {
  componentIndex: number;
  attr: string;
  value: string;
  declared: ComponentCtor | 'node';
  /** Set for an element of an array-of-references prop — the slot to fill. */
  index?: number;
}

/** Compile an already-validated tree, resolving referenced resource files. */
function compileTree(
  root: SncElement,
  options: CompileOptions,
): { scene: CompiledScene; diagnostics: SncDiagnostic[]; provenance: SceneProvenance } {
  const scene: CompiledScene = { root: 0, nodes: [], attachments: [], components: [] };
  const diagnostics: SncDiagnostic[] = [];
  // Editor provenance, index-aligned with scene.nodes / scene.attachments.
  const nodeOrigins: NodeOrigin[] = [];
  const attachmentSrc: (string | null)[] = [];

  const nodeIdToIndex = new Map<string, number>();
  const componentIdToIndex = new Map<string, number>();
  const componentsOnNode = new Map<number, RefTarget[]>();
  const pending: PendingRef[] = [];
  // One content-addressed pool so identical attachments (geometry/material/…) are shared.
  const attachmentPool = new Map<string, number>();
  // Prefab files referenced by `prefab` props, deduped by source path.
  const prefabPool = new Map<string, number>();

  const internAttachment = (asset: CompiledAsset, src?: string): number => {
    const key = `${asset.tag}|${JSON.stringify(asset.attrs)}|${asset.uniforms ? JSON.stringify(asset.uniforms) : ''}`;
    const existing = attachmentPool.get(key);
    if (existing !== undefined) return existing;
    const index = scene.attachments.length;
    scene.attachments.push(asset);
    attachmentSrc[index] = src ?? null;
    attachmentPool.set(key, index);
    return index;
  };

  /**
   * Resolve a `prefab="…"` file, compile it to a standalone prefab CompiledScene,
   * and intern it into the scene's prefabs[] pool. Returns its index, or
   * undefined (with a diagnostic) if it can't be resolved/compiled.
   */
  const internPrefab = (src: string, el: SncElement): number | undefined => {
    const cached = prefabPool.get(src);
    if (cached !== undefined) return cached;

    const push = (code: string, message: string, file?: string) =>
      diagnostics.push({ line: el.line, column: el.column, code, message, ...(file ? { file } : {}) });

    if (!options.resolve) {
      push('no-resolver', `<${el.tag}> uses prefab="${src}" but no resource resolver is configured`);
      return undefined;
    }
    const file = options.resolve(src, options.path ?? '');
    if (!file) {
      push('resource-not-found', `Cannot resolve prefab="${src}"`);
      return undefined;
    }
    const result = compilePrefabXml(file.contents, { path: file.path, resolve: options.resolve });
    if (!result.ok) {
      for (const d of result.diagnostics) diagnostics.push({ ...d, file: d.file ?? file.path });
      return undefined;
    }
    const prefabs = (scene.prefabs ??= []);
    const index = prefabs.length;
    prefabs.push(result.scene);
    prefabPool.set(src, index);
    return index;
  };

  const buildNode = (el: SncElement, parent: number): number => {
    const def = getNodeDef(el.tag)!;
    const index = scene.nodes.length;
    const id = el.attributes.get('id');
    const node: CompiledNode = {
      tag: el.tag,
      ...(id !== undefined ? { id } : {}),
      parent,
      children: [],
      transform: compileTransform(el),
      attrs: compileAttrs(el, def.attrs),
      attachments: [],
      components: [],
    };
    scene.nodes.push(node);
    if (id !== undefined) nodeIdToIndex.set(id, index);
    // Origin: a scene-level instance root carries `prefabSrc`; anything else with a
    // `.file` was expanded from inside a prefab; the rest is authored here.
    nodeOrigins[index] =
      el.prefabSrc !== undefined
        ? { kind: 'prefab-root', src: el.prefabSrc }
        : el.file !== undefined
          ? { kind: 'prefab-internal' }
          : { kind: 'scene' };

    for (const child of el.children) {
      const attDef = getAttachmentDef(child.tag);
      if (attDef) {
        const attrs = resolveAttachmentAttrs(child, attDef.attrs, options, diagnostics);
        const asset: CompiledAsset = { tag: child.tag, attrs };
        // Shader attachments resolve their .vert/.frag and validate their <Uniform>s.
        if (attDef.children?.includes('Uniform')) compileShader(child, asset, options, diagnostics);
        node.attachments.push(internAttachment(asset, child.attributes.get('src')));
      } else if (child.tag === 'Components') {
        buildComponents(child, index, node);
      } else if (getNodeDef(child.tag)) {
        node.children.push(buildNode(child, index));
      }
    }
    return index;
  };

  const buildComponents = (block: SncElement, nodeIndex: number, node: CompiledNode): void => {
    const targets = componentsOnNode.get(nodeIndex) ?? [];
    componentsOnNode.set(nodeIndex, targets);

    for (const el of block.children) {
      const entry = Registry.getComponent(el.tag);
      if (!entry) continue; // validated; unreachable
      const componentIndex = scene.components.length;
      const id = el.attributes.get('id');
      const compiled: CompiledComponent = {
        type: el.tag,
        ...(id !== undefined ? { id } : {}),
        node: nodeIndex,
        props: {},
      };
      scene.components.push(compiled);
      node.components.push(componentIndex);
      targets.push({ ctor: entry.ctor, componentIndex });
      if (id !== undefined) componentIdToIndex.set(id, componentIndex);

      collectComponentProps(el, entry.meta.properties, componentIndex, compiled, pending, internPrefab);
      // A component may point `src=` at a package-owned document (e.g. a particle
      // system's `.particle.xml`) — but only when a src-compiler is registered for
      // it. Otherwise `src` is an ordinary property (e.g. <Sound src="music.mp3">).
      const srcAttr = el.attributes.get('src');
      if (srcAttr !== undefined && getSrcCompiler(el.tag)) {
        compileComponentSrc(el, srcAttr.trim(), compiled, options, diagnostics);
      }
    }
  };

  buildNode(root, -1);

  // Second pass: resolve references now that every node and component is indexed.
  for (const ref of pending) {
    const resolved = resolveRef(ref, nodeIdToIndex, componentIdToIndex, componentsOnNode);
    if (!resolved) continue;
    const props = scene.components[ref.componentIndex]!.props;
    if (ref.index !== undefined) (props[ref.attr] as CompiledRef[])[ref.index] = resolved;
    else props[ref.attr] = resolved;
  }

  return { scene, diagnostics, provenance: { nodes: nodeOrigins, attachments: attachmentSrc } };
}

/**
 * Compute an attachment's attributes, pulling defaults from a `src=` resource
 * file when present (inline attributes override the file) — e.g. a shared
 * `.material.xml`. Diagnostics for a missing/invalid file point at that file.
 */
function resolveAttachmentAttrs(
  el: SncElement,
  attrs: Record<string, NodeAttr>,
  options: CompileOptions,
  diagnostics: SncDiagnostic[],
): Record<string, CompiledScalar | CompiledScalar[]> {
  const src = el.attributes.get('src');
  if (src === undefined) return compileAttrs(el, attrs);
  // An asset-flagged `src` (e.g. <Model src="hero.glb">) is a runtime asset URL,
  // not a compile-time resource file to inline — keep it as a plain string attr.
  if (attrs.src?.asset) return compileAttrs(el, attrs);

  const push = (d: Omit<SncDiagnostic, 'line' | 'column'> & Partial<Pick<SncDiagnostic, 'line' | 'column'>>) =>
    diagnostics.push({ line: el.line, column: el.column, ...d });

  if (!options.resolve) {
    push({ code: 'no-resolver', message: `<${el.tag}> uses src="${src}" but no resource resolver is configured` });
    return compileAttrs(el, attrs);
  }
  const file = options.resolve(src, options.path ?? '');
  if (!file) {
    push({ code: 'resource-not-found', message: `Cannot resolve src="${src}"` });
    return compileAttrs(el, attrs);
  }
  const parsed = parseScene(file.contents);
  if (!parsed.ok) {
    for (const d of parsed.diagnostics) diagnostics.push({ ...d, file: file.path });
    return compileAttrs(el, attrs);
  }
  const fileRoot = parsed.root;
  if (fileRoot.tag !== el.tag) {
    push({ code: 'resource-tag-mismatch', message: `src="${src}" defines a <${fileRoot.tag}>, but it is used as a <${el.tag}>` });
    return compileAttrs(el, attrs);
  }
  // File attributes are the base; inline attributes (except src) override them.
  const merged = new Map<string, string>();
  for (const [k, v] of fileRoot.attributes) if (k in attrs) merged.set(k, v);
  for (const [k, v] of el.attributes) if (k !== 'src' && k in attrs) merged.set(k, v);
  // Validate the file's own values so a bad resource reports against its file.
  for (const [k, v] of fileRoot.attributes) {
    if (isNamespaceAttr(k)) continue; // xmlns / xsi schema hints for IDEs
    const meta = attrs[k];
    if (!meta) {
      diagnostics.push({ line: fileRoot.line, column: fileRoot.column, file: file.path, code: 'unknown-attr', message: `<${fileRoot.tag}> has no attribute "${k}"` });
      continue;
    }
    const check = isArrayType(meta.type) ? parseScalarArray(v, meta.type[0]) : scalarCodec(meta.type).parse(v);
    if (!check.ok) {
      diagnostics.push({ line: fileRoot.line, column: fileRoot.column, file: file.path, code: 'bad-value', message: `<${fileRoot.tag}> attribute "${k}": ${check.message}` });
    }
  }
  const out: Record<string, CompiledScalar | CompiledScalar[]> = {};
  for (const [key, meta] of Object.entries(attrs)) {
    out[key] = attrValue(meta, merged.get(key));
  }
  return out;
}

/**
 * Resolve a `<ShaderMaterial>`'s vertex/fragment files into inline GLSL (so the
 * bundle is self-contained) and compile + cross-validate its `<Uniform>` children
 * against the shader's actual uniform declarations. Mutates `asset` in place.
 */
function compileShader(child: SncElement, asset: CompiledAsset, options: CompileOptions, diagnostics: SncDiagnostic[]): void {
  const push = (code: string, message: string) =>
    diagnostics.push({ line: child.line, column: child.column, code, message, ...(child.file ? { file: child.file } : {}) });

  const vertex = resolveShader('vertex', child, options, push);
  const fragment = resolveShader('fragment', child, options, push);
  asset.attrs.vertex = vertex ?? '';
  asset.attrs.fragment = fragment ?? '';

  // The set of uniforms the shaders actually declare (name → GLSL type).
  const declared = new Map<string, string>();
  for (const glsl of [vertex, fragment]) if (glsl) for (const [name, type] of parseUniforms(glsl)) declared.set(name, type);

  const uniforms: CompiledUniform[] = [];
  for (const u of child.children) {
    if (u.tag !== 'Uniform') continue; // structurally validated by the Validator
    const name = u.attributes.get('name');
    const type = u.attributes.get('type');
    if (name === undefined || type === undefined) continue;
    const glslType = declared.get(name);
    if (glslType === undefined) {
      push('bad-value', `<Uniform> "${name}" is not declared in the shader (uniforms: ${[...declared.keys()].join(', ') || 'none'})`);
      continue;
    }
    if (!glslMatches(type, glslType)) {
      push('bad-value', `<Uniform> "${name}" is declared "${type}" but the shader uniform is "${glslType}"`);
      continue;
    }
    const parsed = uniformValue(type, u.attributes.get('value') ?? '');
    if (!parsed.ok) {
      push('bad-value', `<Uniform> "${name}" value: ${parsed.message}`);
      continue;
    }
    uniforms.push({ name, type, value: parsed.value });
  }
  if (uniforms.length > 0) asset.uniforms = uniforms;
}

function resolveShader(
  attr: 'vertex' | 'fragment',
  child: SncElement,
  options: CompileOptions,
  push: (code: string, message: string) => void,
): string | undefined {
  const path = child.attributes.get(attr)?.trim();
  if (!path) {
    push('missing-attr', `<ShaderMaterial> requires "${attr}" (a ${attr === 'vertex' ? '.vert' : '.frag'}/.glsl file path)`);
    return undefined;
  }
  if (!options.resolve) {
    push('no-resolver', `<ShaderMaterial> ${attr}="${path}" but no resource resolver is configured`);
    return undefined;
  }
  const file = options.resolve(path, options.path ?? '');
  if (!file) {
    push('resource-not-found', `Cannot resolve ${attr}="${path}"`);
    return undefined;
  }
  return file.contents;
}

function compileTransform(el: SncElement): CompiledTransform {
  const t = (key: string) => {
    const meta = TRANSFORM_ATTRS[key]!;
    return scalarValue(meta.type as ScalarType, el.attributes.get(key), meta.default as CompiledScalar | undefined);
  };
  return {
    position: t('position') as number[],
    rotation: t('rotation') as number[],
    scale: t('scale') as number[],
    visible: t('visible') as boolean,
  };
}

function compileAttrs(el: SncElement, attrs: Record<string, NodeAttr>): Record<string, CompiledScalar | CompiledScalar[]> {
  const out: Record<string, CompiledScalar | CompiledScalar[]> = {};
  for (const [key, meta] of Object.entries(attrs)) {
    out[key] = attrValue(meta, el.attributes.get(key));
  }
  return out;
}

/**
 * Resolve a component's `src=` document and compile it to a config blob stored on
 * the component. A `*.json` src is loaded as an already-compiled config (e.g. a
 * three.quarks export); any other file is parsed and handed to the src-compiler
 * the owning package registered for this component type (`registerSrcCompiler`).
 * Diagnostics about the file point at that file.
 */
function compileComponentSrc(
  el: SncElement,
  src: string,
  compiled: CompiledComponent,
  options: CompileOptions,
  diagnostics: SncDiagnostic[],
): void {
  const atEl = (code: string, message: string): void => {
    diagnostics.push({ line: el.line, column: el.column, code, message, ...(el.file ? { file: el.file } : {}) });
  };
  if (src === '') return atEl('missing-src', `<${el.tag}> has an empty src=`);
  if (!options.resolve) return atEl('no-resolver', `<${el.tag}> uses src="${src}" but no resource resolver is configured`);
  const file = options.resolve(src, options.path ?? '');
  if (!file) return atEl('resource-not-found', `Cannot resolve src="${src}"`);

  // `*.json` is an already-compiled config blob (e.g. a three.quarks export).
  if (src.toLowerCase().endsWith('.json')) {
    try {
      compiled.config = JSON.parse(file.contents);
    } catch (e) {
      diagnostics.push({ line: 1, column: 1, code: 'bad-json', message: `src="${src}" is not valid JSON: ${(e as Error).message}`, file: file.path });
    }
    return;
  }

  const compileDoc = getSrcCompiler(el.tag);
  if (!compileDoc) {
    return atEl(
      'no-src-compiler',
      `<${el.tag}> uses src="${src}" but no src-document compiler is registered — import the package that defines <${el.tag}>`,
    );
  }
  const parsed = parseScene(file.contents);
  if (!parsed.ok) {
    for (const d of parsed.diagnostics) diagnostics.push({ ...d, file: file.path });
    return;
  }
  const result = compileDoc(toParsedElement(parsed.root), { file: file.path });
  for (const d of result.diagnostics ?? []) {
    diagnostics.push({ line: 1, column: 1, code: d.code ?? 'src-document', message: d.message, file: file.path });
  }
  if (result.config !== undefined) compiled.config = result.config;
}

/** Adapt the compiler's parsed element to the core `ParsedElement` a src-compiler receives. */
function toParsedElement(el: SncElement): ParsedElement {
  return { tag: el.tag, attributes: Object.fromEntries(el.attributes), children: el.children.map(toParsedElement) };
}

function collectComponentProps(
  el: SncElement,
  props: Map<string, PropertyMeta>,
  componentIndex: number,
  compiled: CompiledComponent,
  pending: PendingRef[],
  internPrefab: (src: string, el: SncElement) => number | undefined,
): void {
  for (const [attr, raw] of el.attributes) {
    if (attr === 'id') continue;
    const meta = props.get(attr);
    if (!meta) continue; // validated
    if (isArrayType(meta.type)) {
      compileArrayProp(attr, raw, elementType(meta.type), componentIndex, compiled, pending, internPrefab, el);
    } else if (isScalarType(meta.type) || isEnumType(meta.type)) {
      compiled.props[attr] = codecParse(meta.type, raw);
    } else if (meta.type === 'prefab') {
      // A prefab prop value is a file path (like src=), not a `#id`. Resolve and
      // embed it at build time; the runtime hands the component a PrefabRef.
      const src = raw.trim();
      if (src !== '') {
        const index = internPrefab(src, el);
        if (index !== undefined) compiled.props[attr] = { prefab: index };
      }
    } else {
      // Reference value is `#id`; store the bare id (validated upstream).
      const value = raw.trim().replace(/^#/, '');
      if (value !== '') pending.push({ componentIndex, attr, value, declared: meta.type });
    }
  }
}

/** Compile one array-typed prop: scalars inline, prefabs interned, refs as indexed pending entries. */
function compileArrayProp(
  attr: string,
  raw: string,
  elem: PropType | ComponentCtor | EnumDef,
  componentIndex: number,
  compiled: CompiledComponent,
  pending: PendingRef[],
  internPrefab: (src: string, el: SncElement) => number | undefined,
  el: SncElement,
): void {
  const literal = parseArrayLiteral(raw);
  if (!literal.ok) return; // validated upstream
  if (isScalarType(elem) || isEnumType(elem)) {
    const r = parseScalarArray(raw, elem);
    compiled.props[attr] = r.ok ? r.value : [];
  } else if (elem === 'prefab') {
    const out: CompiledRef[] = [];
    for (const piece of literal.value) {
      const src = piece.trim();
      if (src === '') continue;
      const index = internPrefab(src, el);
      if (index !== undefined) out.push({ prefab: index });
    }
    compiled.props[attr] = out;
  } else {
    // Reference array: pre-create the slot, fill each element in the resolution pass.
    compiled.props[attr] = [] as CompiledRef[];
    literal.value.forEach((piece, i) => {
      const value = piece.trim().replace(/^#/, '');
      if (value !== '') pending.push({ componentIndex, attr, value, declared: elem, index: i });
    });
  }
}

function resolveRef(
  ref: PendingRef,
  nodeIdToIndex: Map<string, number>,
  componentIdToIndex: Map<string, number>,
  componentsOnNode: Map<number, RefTarget[]>,
): CompiledRef | undefined {
  if (ref.declared === 'node') {
    const idx = nodeIdToIndex.get(ref.value);
    return idx === undefined ? undefined : { node: idx };
  }
  const byId = componentIdToIndex.get(ref.value);
  if (byId !== undefined) return { component: byId };

  const nodeIndex = nodeIdToIndex.get(ref.value);
  if (nodeIndex === undefined) return undefined;
  const declared = ref.declared;
  const match = (componentsOnNode.get(nodeIndex) ?? []).find(
    (c) => c.ctor === declared || c.ctor.prototype instanceof declared,
  );
  return match ? { component: match.componentIndex } : undefined;
}

const codecParse = (type: ScalarType | EnumDef, raw: string): CompiledScalar => {
  const r = scalarCodec(type).parse(raw);
  return r.ok ? r.value : (zeroFor(type) as CompiledScalar);
};

/** Compile a node/attachment attr value — scalar or scalar-array — from its raw text. */
function attrValue(meta: NodeAttr, raw: string | undefined): CompiledScalar | CompiledScalar[] {
  if (isArrayType(meta.type)) {
    return arrayValue(meta.type[0], raw, meta.default as CompiledScalar[] | undefined);
  }
  return scalarValue(meta.type, raw, meta.default as CompiledScalar | undefined);
}

function scalarValue(
  type: ScalarType | EnumDef,
  raw: string | undefined,
  fallback: CompiledScalar | undefined,
): CompiledScalar {
  if (raw === undefined) return fallback ?? zeroFor(type);
  const r = scalarCodec(type).parse(raw);
  return r.ok ? r.value : (fallback ?? zeroFor(type));
}

function arrayValue(
  elem: ScalarType | EnumDef,
  raw: string | undefined,
  fallback: CompiledScalar[] | undefined,
): CompiledScalar[] {
  if (raw === undefined) return fallback ?? [];
  const r = parseScalarArray(raw, elem);
  return r.ok ? r.value : (fallback ?? []);
}

function zeroFor(type: ScalarType | EnumDef): CompiledScalar {
  if (isEnumType(type)) return type.defaultValue;
  switch (type) {
    case 'bool':
      return false;
    case 'string':
      return '';
    case 'vec2':
      return [0, 0];
    case 'vec3':
    case 'euler':
      return [0, 0, 0];
    default:
      return 0;
  }
}
