import {
  isScalarType,
  isSpatial,
  Registry,
  getNodeDef,
  getAttachmentDef,
  TRANSFORM_ATTRS,
  type ComponentCtor,
  type PropertyMeta,
  type NodeAttr,
  type CompiledAsset,
  type CompiledComponent,
  type CompiledNode,
  type CompiledRef,
  type CompiledScene,
  type CompiledTransform,
} from '@scenoco-three/core/internal';
import { parseScene, type SceElement } from './SceneParser.js';
import { validatePrefab, validateScene } from './Validator.js';
import { expandPrefabs } from './prefab.js';
import { codecs, type CompiledScalar, type ScalarType } from './types.js';
import type { SceDiagnostic } from './diagnostics.js';

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
  | { ok: true; scene: CompiledScene }
  | { ok: false; diagnostics: SceDiagnostic[] };

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
  const expansion: SceDiagnostic[] = [];
  expandPrefabs(parsed.root, options.path ?? '', options, expansion);
  if (expansion.length > 0) return { ok: false, diagnostics: sortDiagnostics(expansion) };

  const diagnostics = validateScene(parsed.root);
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const result = compileTree(parsed.root, options);
  if (result.diagnostics.length > 0) return { ok: false, diagnostics: result.diagnostics };
  return { ok: true, scene: result.scene };
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

  const expansion: SceDiagnostic[] = [];
  expandPrefabs(parsed.root, options.path ?? '', options, expansion);
  if (expansion.length > 0) return { ok: false, diagnostics: sortDiagnostics(expansion) };

  const diagnostics = validatePrefab(parsed.root);
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const prefabRoot = parsed.root.children.find((c) => isSpatial(c.tag))!;
  const result = compileTree(prefabRoot, options);
  if (result.diagnostics.length > 0) return { ok: false, diagnostics: result.diagnostics };
  return { ok: true, scene: result.scene };
}

function sortDiagnostics(diagnostics: SceDiagnostic[]): SceDiagnostic[] {
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
}

/** Compile an already-validated tree, resolving referenced resource files. */
function compileTree(
  root: SceElement,
  options: CompileOptions,
): { scene: CompiledScene; diagnostics: SceDiagnostic[] } {
  const scene: CompiledScene = { root: 0, nodes: [], attachments: [], components: [] };
  const diagnostics: SceDiagnostic[] = [];

  const nodeIdToIndex = new Map<string, number>();
  const componentIdToIndex = new Map<string, number>();
  const componentsOnNode = new Map<number, RefTarget[]>();
  const pending: PendingRef[] = [];
  // One content-addressed pool so identical attachments (geometry/material/…) are shared.
  const attachmentPool = new Map<string, number>();
  // Prefab files referenced by `prefab` props, deduped by source path.
  const prefabPool = new Map<string, number>();

  const internAttachment = (asset: CompiledAsset): number => {
    const key = `${asset.tag}|${JSON.stringify(asset.attrs)}`;
    const existing = attachmentPool.get(key);
    if (existing !== undefined) return existing;
    const index = scene.attachments.length;
    scene.attachments.push(asset);
    attachmentPool.set(key, index);
    return index;
  };

  /**
   * Resolve a `prefab="…"` file, compile it to a standalone prefab CompiledScene,
   * and intern it into the scene's prefabs[] pool. Returns its index, or
   * undefined (with a diagnostic) if it can't be resolved/compiled.
   */
  const internPrefab = (src: string, el: SceElement): number | undefined => {
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

  const buildNode = (el: SceElement, parent: number): number => {
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

    for (const child of el.children) {
      const attDef = getAttachmentDef(child.tag);
      if (attDef) {
        const attrs = resolveAttachmentAttrs(child, attDef.attrs, options, diagnostics);
        node.attachments.push(internAttachment({ tag: child.tag, attrs }));
      } else if (child.tag === 'Components') {
        buildComponents(child, index, node);
      } else if (getNodeDef(child.tag)) {
        node.children.push(buildNode(child, index));
      }
    }
    return index;
  };

  const buildComponents = (block: SceElement, nodeIndex: number, node: CompiledNode): void => {
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
    }
  };

  buildNode(root, -1);

  // Second pass: resolve references now that every node and component is indexed.
  for (const ref of pending) {
    const resolved = resolveRef(ref, nodeIdToIndex, componentIdToIndex, componentsOnNode);
    if (resolved) scene.components[ref.componentIndex]!.props[ref.attr] = resolved;
  }

  return { scene, diagnostics };
}

/**
 * Compute an attachment's attributes, pulling defaults from a `src=` resource
 * file when present (inline attributes override the file) — e.g. a shared
 * `.material.xml`. Diagnostics for a missing/invalid file point at that file.
 */
function resolveAttachmentAttrs(
  el: SceElement,
  attrs: Record<string, NodeAttr>,
  options: CompileOptions,
  diagnostics: SceDiagnostic[],
): Record<string, CompiledScalar> {
  const src = el.attributes.get('src');
  if (src === undefined) return compileAttrs(el, attrs);

  const push = (d: Omit<SceDiagnostic, 'line' | 'column'> & Partial<Pick<SceDiagnostic, 'line' | 'column'>>) =>
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
    const meta = attrs[k];
    if (!meta) {
      diagnostics.push({ line: fileRoot.line, column: fileRoot.column, file: file.path, code: 'unknown-attr', message: `<${fileRoot.tag}> has no attribute "${k}"` });
    } else if (!codecs[meta.type].parse(v).ok) {
      diagnostics.push({ line: fileRoot.line, column: fileRoot.column, file: file.path, code: 'bad-value', message: `<${fileRoot.tag}> attribute "${k}": ${(codecs[meta.type].parse(v) as { message: string }).message}` });
    }
  }
  const out: Record<string, CompiledScalar> = {};
  for (const [key, meta] of Object.entries(attrs)) {
    out[key] = scalarValue(meta.type, merged.get(key), meta.default);
  }
  return out;
}

function compileTransform(el: SceElement): CompiledTransform {
  const t = (key: string) => {
    const meta = TRANSFORM_ATTRS[key]!;
    return scalarValue(meta.type, el.attributes.get(key), meta.default);
  };
  return {
    position: t('position') as number[],
    rotation: t('rotation') as number[],
    scale: t('scale') as number[],
    visible: t('visible') as boolean,
  };
}

function compileAttrs(el: SceElement, attrs: Record<string, NodeAttr>): Record<string, CompiledScalar> {
  const out: Record<string, CompiledScalar> = {};
  for (const [key, meta] of Object.entries(attrs)) {
    out[key] = scalarValue(meta.type, el.attributes.get(key), meta.default);
  }
  return out;
}

function collectComponentProps(
  el: SceElement,
  props: Map<string, PropertyMeta>,
  componentIndex: number,
  compiled: CompiledComponent,
  pending: PendingRef[],
  internPrefab: (src: string, el: SceElement) => number | undefined,
): void {
  for (const [attr, raw] of el.attributes) {
    if (attr === 'id') continue;
    const meta = props.get(attr);
    if (!meta) continue; // validated
    if (isScalarType(meta.type)) {
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

const codecParse = (type: ScalarType, raw: string): CompiledScalar => {
  const r = codecs[type].parse(raw);
  return r.ok ? r.value : (zeroFor(type) as CompiledScalar);
};

function scalarValue(
  type: ScalarType,
  raw: string | undefined,
  fallback: CompiledScalar | undefined,
): CompiledScalar {
  if (raw === undefined) return fallback ?? zeroFor(type);
  const r = codecs[type].parse(raw);
  return r.ok ? r.value : (fallback ?? zeroFor(type));
}

function zeroFor(type: ScalarType): CompiledScalar {
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
