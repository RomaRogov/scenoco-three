import {
  isScalarType,
  isSpatial,
  getNodeDef,
  Registry,
  TRANSFORM_ATTRS,
} from '@scenoco-three/core/internal';
import type { CompileOptions } from './compile.js';
import type { SceDiagnostic } from './diagnostics.js';
import { parseScene, type SceElement } from './SceneParser.js';
import { codecs, type ScalarType } from './types.js';
import { validatePrefab } from './Validator.js';

/**
 * Prefab expansion — a pre-pass on the parsed element tree.
 *
 * A prefab *file* has a `<Prefab>` root wrapping one node; a *scene* places an
 * instance of it with `<PrefabInstance src="x.prefab.xml" id="t1" …/>` (the two
 * tags are distinct so neither is ambiguous). Each `<PrefabInstance>` is
 * replaced, at compile time, by the prefab file's node subtree:
 *
 *  - the prefab file is parsed, recursively expanded, and validated standalone
 *    (prefabs are self-contained — that's what makes them dynamically loadable);
 *  - internal ids are namespaced into the instance scope (`osc` → `t1/osc`,
 *    composing for nested prefabs: `t1/inner/osc`) and internal `#refs` are
 *    rewritten to match; the prefab root's own id becomes the instance id;
 *  - instance transform attributes override the prefab root's (file = defaults,
 *    inline overrides — same rule as material `src=`);
 *  - `<Override target="#osc" amplitude="2"/>` children patch any internal
 *    node/component by its prefab-local id;
 *  - a `<Components>` child adds extra components to the instance root.
 *
 * Nesting: a prefab file may itself contain `<PrefabInstance>` children, which
 * are expanded depth-first (and scoped: `t1/inner/osc`), so prefabs compose.
 *
 * Because expansion happens before validation, the validator and compiler see
 * ordinary nodes — the bundle format is untouched, and the scene can address
 * instance internals (`target="#t1/osc"`) like any other id.
 */
export function expandPrefabs(
  root: SceElement,
  referrer: string,
  options: CompileOptions,
  diagnostics: SceDiagnostic[],
  stack: string[] = [],
): void {
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i]!;
    if (child.tag === 'PrefabInstance') {
      if (!child.attributes.has('src')) {
        diagnostics.push({ line: child.line, column: child.column, code: 'prefab-missing-src', message: `<PrefabInstance> requires a src="…prefab.xml" attribute`, ...(child.file ? { file: child.file } : {}) });
        continue;
      }
      const expanded = expandInstance(child, referrer, options, diagnostics, stack);
      if (expanded) {
        expanded.parent = root;
        root.children[i] = expanded;
      }
      continue;
    }
    expandPrefabs(child, referrer, options, diagnostics, stack);
  }
}

function expandInstance(
  instance: SceElement,
  referrer: string,
  options: CompileOptions,
  diagnostics: SceDiagnostic[],
  stack: string[],
): SceElement | null {
  const fail = (code: string, message: string, el: SceElement = instance) =>
    void diagnostics.push({ line: el.line, column: el.column, code, message, ...(el.file ? { file: el.file } : {}) });

  const src = instance.attributes.get('src')!;
  const instanceId = instance.attributes.get('id');
  if (instanceId === undefined || instanceId === '') {
    fail('prefab-missing-id', `<PrefabInstance src="${src}"> requires an id — instance internals are addressed as "#<id>/<inner>"`);
    return null;
  }

  if (!options.resolve) {
    fail('no-resolver', `<PrefabInstance> uses src="${src}" but no resource resolver is configured`);
    return null;
  }
  const file = options.resolve(src, referrer);
  if (!file) {
    fail('prefab-not-found', `Cannot resolve src="${src}"`);
    return null;
  }
  if (stack.includes(file.path)) {
    fail('prefab-cycle', `Prefab cycle: ${[...stack, file.path].join(' → ')}`);
    return null;
  }

  const parsed = parseScene(file.contents);
  if (!parsed.ok) {
    diagnostics.push(...parsed.diagnostics.map((d) => ({ ...d, file: d.file ?? file.path })));
    return null;
  }

  // Depth-first: expand the prefab's own instances, then validate it standalone.
  expandPrefabs(parsed.root, file.path, options, diagnostics, [...stack, file.path]);
  const prefabDiags = validatePrefab(parsed.root);
  if (prefabDiags.length > 0) {
    diagnostics.push(...prefabDiags.map((d) => ({ ...d, file: d.file ?? file.path })));
    return null;
  }

  const prefabRoot = parsed.root.children.find((c) => isSpatial(c.tag))!;
  const clone = cloneSubtree(prefabRoot, file.path, null);

  // Scope ids into the instance: root id → instance id, inner `x` → `id/x`.
  const rename = buildRenameMap(clone, instanceId);
  applyRenames(clone, rename);

  // Instance transform attributes override the prefab root's.
  for (const key of Object.keys(TRANSFORM_ATTRS)) {
    const value = instance.attributes.get(key);
    if (value === undefined) continue;
    const meta = TRANSFORM_ATTRS[key]!;
    if (!codecs[meta.type].parse(value).ok) {
      fail('bad-value', `<PrefabInstance> attribute "${key}": ${(codecs[meta.type].parse(value) as { message: string }).message}`);
    }
    clone.attributes.set(key, value);
  }
  for (const attr of instance.attributes.keys()) {
    if (attr === 'src' || attr === 'id' || attr in TRANSFORM_ATTRS || isNamespaceAttr(attr)) continue;
    fail('unknown-attr', `<PrefabInstance> has no attribute "${attr}" (allowed: src, id, ${Object.keys(TRANSFORM_ATTRS).join(', ')})`);
  }

  // Instance children: <Override target="#inner" …/> patches and an optional
  // <Components> block appended to the instance root.
  for (const child of instance.children) {
    if (child.tag === 'Override') {
      applyOverride(child, clone, rename, instanceId, fail);
    } else if (child.tag === 'Components') {
      let block = clone.children.find((c) => c.tag === 'Components');
      if (!block) {
        block = { tag: 'Components', attributes: new Map(), children: [], parent: clone, line: child.line, column: child.column };
        clone.children.push(block);
      }
      for (const comp of child.children) {
        comp.parent = block;
        block.children.push(comp);
      }
    } else {
      fail('unexpected-child', `<PrefabInstance> may only contain <Override> and <Components> (found <${child.tag}>)`, child);
    }
  }

  return clone;
}

// ---- subtree mechanics ------------------------------------------------------

function cloneSubtree(el: SceElement, file: string, parent: SceElement | null): SceElement {
  const clone: SceElement = {
    tag: el.tag,
    attributes: new Map(el.attributes),
    children: [],
    parent,
    line: el.line,
    column: el.column,
    file: el.file ?? file,
  };
  clone.children = el.children.map((c) => cloneSubtree(c, file, clone));
  return clone;
}

/** old prefab-local id → scoped id. The root's own id maps to the instance id. */
function buildRenameMap(clonedRoot: SceElement, instanceId: string): Map<string, string> {
  const rename = new Map<string, string>();
  const rootId = clonedRoot.attributes.get('id');
  if (rootId !== undefined) rename.set(rootId, instanceId);

  const walk = (el: SceElement) => {
    if (el !== clonedRoot) {
      const id = el.attributes.get('id');
      if (id !== undefined && idCarrier(el)) rename.set(id, `${instanceId}/${id}`);
    }
    for (const c of el.children) walk(c);
  };
  walk(clonedRoot);
  // The root always carries the instance id, even if it had none in the file.
  clonedRoot.attributes.set('id', instanceId);
  return rename;
}

function applyRenames(root: SceElement, rename: Map<string, string>): void {
  const walk = (el: SceElement) => {
    if (el !== root && idCarrier(el)) {
      const id = el.attributes.get('id');
      const renamed = id !== undefined ? rename.get(id) : undefined;
      if (renamed !== undefined) el.attributes.set('id', renamed);
    }
    // Rewrite reference values on component elements (`#old` → `#scoped`).
    if (el.parent?.tag === 'Components') {
      const entry = Registry.getComponent(el.tag);
      if (entry) {
        for (const [attr, value] of el.attributes) {
          const meta = entry.meta.properties.get(attr);
          if (!meta || isScalarType(meta.type) || !value.startsWith('#')) continue;
          const renamed = rename.get(value.slice(1).trim());
          if (renamed !== undefined) el.attributes.set(attr, `#${renamed}`);
        }
      }
    }
    for (const c of el.children) walk(c);
  };
  walk(root);
}

/** Elements whose `id` participates in the scene namespace (nodes + components). */
function idCarrier(el: SceElement): boolean {
  return isSpatial(el.tag) || el.parent?.tag === 'Components';
}

// ---- <Override> -------------------------------------------------------------

function applyOverride(
  override: SceElement,
  clonedRoot: SceElement,
  rename: Map<string, string>,
  instanceId: string,
  fail: (code: string, message: string, el?: SceElement) => void,
): void {
  const target = override.attributes.get('target');
  if (target === undefined || !target.startsWith('#')) {
    fail('ref-missing-hash', `<Override> needs target="#<prefab-local id>" (e.g. target="#osc")`, override);
    return;
  }
  const localId = target.slice(1).trim();
  const scopedId = rename.get(localId) ?? (localId === instanceId ? instanceId : undefined);
  const found = scopedId !== undefined ? findById(clonedRoot, scopedId) : undefined;
  if (!found) {
    const known = [...rename.keys()].join(', ') || '(none)';
    fail('override-unknown-target', `<Override> target "#${localId}" does not exist in the prefab. Ids declared there: ${known}`, override);
    return;
  }

  // Validate override values against the target's schema *here*, so errors
  // point at the <Override> the author wrote, not into the prefab file.
  const schema = attrSchema(found);
  for (const [attr, value] of override.attributes) {
    if (attr === 'target') continue;
    const type = schema.get(attr);
    if (type === undefined) {
      fail('unknown-attr', `<Override>: <${found.tag}> has no attribute "${attr}"`, override);
      continue;
    }
    if (type !== null && !codecs[type].parse(value).ok) {
      fail('bad-value', `<Override> "${attr}": ${(codecs[type].parse(value) as { message: string }).message}`, override);
      continue;
    }
    found.attributes.set(attr, value);
  }
}

function findById(root: SceElement, id: string): SceElement | undefined {
  if (root.attributes.get('id') === id) return root;
  for (const c of root.children) {
    const found = findById(c, id);
    if (found) return found;
  }
  return undefined;
}

/** attr → scalar type for value checking; `null` marks reference props (any #id). */
function attrSchema(el: SceElement): Map<string, ScalarType | null> {
  const out = new Map<string, ScalarType | null>();
  if (el.parent?.tag === 'Components') {
    const entry = Registry.getComponent(el.tag);
    if (entry) {
      for (const [name, meta] of entry.meta.properties) {
        out.set(name, isScalarType(meta.type) ? meta.type : null);
      }
    }
    return out;
  }
  const def = getNodeDef(el.tag);
  if (def) {
    for (const [name, meta] of Object.entries({ ...TRANSFORM_ATTRS, ...def.attrs })) out.set(name, meta.type);
  }
  return out;
}

function isNamespaceAttr(name: string): boolean {
  return name === 'xmlns' || name.startsWith('xmlns:') || name.startsWith('xsi:');
}
