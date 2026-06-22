import {
  isScalarType,
  isEnumType,
  isArrayType,
  elementType,
  Registry,
  getNodeDef,
  getAttachmentDef,
  allAttachmentDefs,
  attachmentAcceptsNode,
  attachmentTags,
  isSpatial,
  nodeTags,
  TRANSFORM_ATTRS,
  type ComponentCtor,
  type EnumDef,
  type PropType,
  type PropertyMeta,
  type NodeAttr,
  type NodeDef,
  type AttachmentDef,
} from '@scenoco-three/core/internal';
import { nearestName, type SceDiagnostic } from './diagnostics.js';
import type { SceElement } from './SceneParser.js';
import { parseArrayLiteral, parseScalarArray, scalarCodec, type ScalarType } from './types.js';

/**
 * Validates a parsed scene tree against the node and component registries,
 * collecting *every* problem (never fail-fast) with a source position and an
 * LLM-actionable message. This is the heart of the edit→check→fix loop: the
 * `scenoco validate` CLI is a thin wrapper over this.
 */
export function validateScene(root: SceElement): SceDiagnostic[] {
  const ctx = new ValidationContext();

  if (root.tag !== 'Scene') {
    ctx.error(root, 'bad-root', `Root element must be <Scene>, got <${root.tag}>`);
    // Still walk it as best we can, so attribute/child errors surface too.
  }
  ctx.walk(root);
  ctx.resolveReferences();
  ctx.diagnostics.sort((a, b) => a.line - b.line || a.column - b.column);
  return ctx.diagnostics;
}

/**
 * Validates a prefab file: a `<Prefab>` root wrapping exactly one spatial node.
 * Prefabs must be **self-contained** — every `#ref` resolves within the file —
 * which is what makes them instantiable at runtime without a surrounding scene.
 */
export function validatePrefab(root: SceElement): SceDiagnostic[] {
  const ctx = new ValidationContext();

  if (root.tag !== 'Prefab') {
    ctx.error(root, 'bad-root', `A prefab file's root element must be <Prefab>, got <${root.tag}>`);
  }
  for (const attr of root.attributes.keys()) {
    ctx.error(root, 'unexpected-attr', `A prefab file's <Prefab> root takes no attributes (found "${attr}")`);
  }

  const spatial = root.children.filter((c) => isSpatial(c.tag));
  if (root.children.length !== 1 || spatial.length !== 1) {
    ctx.error(
      root,
      'bad-prefab-root',
      `<Prefab> must contain exactly one node (e.g. a <Mesh> or <Group>); found ${root.children.length}`,
    );
  }
  for (const child of root.children) ctx.walk(child);
  ctx.resolveReferences();
  ctx.diagnostics.sort((a, b) => a.line - b.line || a.column - b.column);
  return ctx.diagnostics;
}

interface PendingRef {
  element: SceElement;
  attr: string;
  value: string;
  /** Component class the reference must satisfy, or 'node' for an Object3D ref. */
  declared: ComponentCtor | 'node';
}

interface IdEntry {
  el: SceElement;
  kind: 'node' | 'component';
}

class ValidationContext {
  readonly diagnostics: SceDiagnostic[] = [];

  // One scene-wide id namespace shared by nodes and components, so a `#id`
  // reference resolves unambiguously to exactly one element.
  private readonly ids = new Map<string, IdEntry>();
  private readonly componentsByNode = new Map<SceElement, ComponentCtor[]>();
  private readonly pendingRefs: PendingRef[] = [];

  error(el: SceElement, code: string, message: string): void {
    // Elements spliced in from another file (prefab expansion) carry their
    // origin so the fix-it loop points at the right file.
    this.diagnostics.push({ line: el.line, column: el.column, code, message, ...(el.file ? { file: el.file } : {}) });
  }

  walk(el: SceElement): void {
    const def = getNodeDef(el.tag);
    if (!def) {
      // Unknown at this position. Components are handled by their parent; if we
      // reach an unregistered, non-Components tag here it's a genuine unknown.
      if (el.tag !== 'Components') {
        const suggestion = nearestName(el.tag, [...nodeTags(), ...attachmentTags(), 'Components']);
        this.error(
          el,
          'unknown-tag',
          `Unknown element <${el.tag}>${suggestion ? `. Did you mean <${suggestion}>?` : ''}`,
        );
      }
      return;
    }
    if (def.kind === 'scene' && el.parent !== null) {
      this.error(el, 'nested-scene', '<Scene> may only be the root element');
    }
    this.validateNodeAttributes(el, def);
    this.validateChildren(el, def);
  }

  private validateChildren(el: SceElement, def: NodeDef): void {
    let componentsCount = 0;
    // group → first attachment tag seen on this node (for uniqueness diagnostics).
    const groupFirst = new Map<string, string>();

    for (const child of el.children) {
      const attDef = getAttachmentDef(child.tag);
      if (attDef) {
        this.validateAttachment(el, def, child, attDef, groupFirst);
        continue;
      }

      if (child.tag === 'Components') {
        if (!def.children.components) {
          this.error(child, 'misplaced-components', `<Components> is not allowed inside <${el.tag}>`);
        } else if (++componentsCount > 1) {
          this.error(child, 'duplicate-components', `<${el.tag}> may have only one <Components> block`);
        }
        this.validateComponentsBlock(el, child);
        continue;
      }

      const childDef = getNodeDef(child.tag);
      if (childDef) {
        if (!def.children.object3d) {
          this.error(child, 'misplaced-node', `<${child.tag}> is not allowed inside <${el.tag}>`);
        }
        this.walk(child);
        continue;
      }

      if (Registry.getComponent(child.tag)) {
        this.error(
          child,
          'component-outside-block',
          `<${child.tag}> is a component and must be placed inside a <Components> block`,
        );
        continue;
      }

      // Truly unknown tag.
      this.walk(child);
    }

    // Required attachment groups (e.g. a <Mesh> needs a geometry).
    for (const [group, tags] of requiredGroupsFor(def)) {
      if (!groupFirst.has(group)) {
        this.error(el, 'missing-required-attachment', `<${el.tag}> requires a ${group} (e.g. <${tags[0]} />)`);
      }
    }
  }

  /** One attachment rule: target-compatible? group cardinality ok? attrs valid? */
  private validateAttachment(
    host: SceElement,
    hostDef: NodeDef,
    child: SceElement,
    attDef: AttachmentDef,
    groupFirst: Map<string, string>,
  ): void {
    if (!attachmentAcceptsNode(attDef, hostDef)) {
      this.error(child, 'attachment-wrong-target', `<${child.tag}> cannot attach to <${host.tag}>${targetHint(attDef)}`);
    } else {
      const prev = groupFirst.get(attDef.group);
      if (prev !== undefined && attDef.unique) {
        this.error(child, 'duplicate-attachment', `<${host.tag}> may have only one ${attDef.group} (already has <${prev}>)`);
      } else if (prev === undefined) {
        groupFirst.set(attDef.group, child.tag);
      }
    }
    this.validateAttachmentAttributes(child, attDef);
    this.rejectChildElements(child);
  }

  private validateComponentsBlock(host: SceElement, block: SceElement): void {
    if (block.attributes.size > 0) {
      this.error(block, 'unexpected-attr', `<Components> takes no attributes`);
    }
    const hostComponents = this.componentsByNode.get(host) ?? [];
    this.componentsByNode.set(host, hostComponents);

    for (const child of block.children) {
      const entry = Registry.getComponent(child.tag);
      if (!entry) {
        if (getNodeDef(child.tag)) {
          this.error(child, 'not-a-component', `<${child.tag}> is not a component; <Components> may only contain components`);
        } else {
          const suggestion = nearestName(child.tag, Registry.componentNames());
          this.error(
            child,
            'unknown-component',
            `Unknown component <${child.tag}>${suggestion ? `. Did you mean <${suggestion}>?` : ''}`,
          );
        }
        continue;
      }
      this.validateComponentAttributes(child, entry.meta.properties);
      hostComponents.push(entry.ctor);
      this.rejectChildElements(child);
    }
  }

  /** Validate a node element's transform + type-specific attributes. */
  private validateNodeAttributes(el: SceElement, def: NodeDef): void {
    const allowed: Record<string, NodeAttr> = { ...TRANSFORM_ATTRS, ...def.attrs };

    for (const [attr, raw] of el.attributes) {
      if (isNamespaceAttr(attr)) continue; // xmlns / xsi schema hints for IDEs
      if (attr === 'id') {
        this.registerId(el, raw, 'node');
        continue;
      }
      const meta = allowed[attr];
      if (!meta) {
        const suggestion = nearestName(attr, [...Object.keys(allowed), 'id']);
        this.error(el, 'unknown-attr', `<${el.tag}> has no attribute "${attr}"${suggestion ? `. Did you mean "${suggestion}"?` : ''}`);
        continue;
      }
      this.parseScalarAttr(el, attr, raw, meta.type);
    }
    for (const [attr, meta] of Object.entries(allowed)) {
      if (meta.required && !el.attributes.has(attr)) {
        this.error(el, 'missing-attr', `<${el.tag}> is missing required attribute "${attr}"`);
      }
    }
  }

  /** Validate an attachment element's attributes (no transform/id; `src` allowed). */
  private validateAttachmentAttributes(el: SceElement, def: AttachmentDef): void {
    for (const [attr, raw] of el.attributes) {
      if (isNamespaceAttr(attr)) continue;
      // An attachment may pull its defaults from a resource file (e.g. a shared
      // .material.xml); the file itself is resolved and checked at compile time.
      if (attr === 'src') continue;
      const meta = def.attrs[attr];
      if (!meta) {
        const suggestion = nearestName(attr, [...Object.keys(def.attrs), 'src']);
        this.error(el, 'unknown-attr', `<${el.tag}> has no attribute "${attr}"${suggestion ? `. Did you mean "${suggestion}"?` : ''}`);
        continue;
      }
      this.parseScalarAttr(el, attr, raw, meta.type);
    }
    for (const [attr, meta] of Object.entries(def.attrs)) {
      if (meta.required && !el.attributes.has(attr)) {
        this.error(el, 'missing-attr', `<${el.tag}> is missing required attribute "${attr}"`);
      }
    }
  }

  /** Validate a component element. */
  private validateComponentAttributes(el: SceElement, props: Map<string, PropertyMeta>): void {
    for (const [attr, raw] of el.attributes) {
      if (isNamespaceAttr(attr)) continue;
      if (attr === 'id') {
        this.registerId(el, raw, 'component');
        continue;
      }
      const meta = props.get(attr);
      if (!meta) {
        const suggestion = nearestName(attr, [...props.keys(), 'id']);
        this.error(el, 'unknown-attr', `<${el.tag}> has no property "${attr}"${suggestion ? `. Did you mean "${suggestion}"?` : ''}`);
        continue;
      }
      if (isArrayType(meta.type)) {
        this.validateArrayAttr(el, attr, raw, elementType(meta.type));
      } else if (isScalarType(meta.type) || isEnumType(meta.type)) {
        this.parseScalarAttr(el, attr, raw, meta.type);
      } else if (meta.type === 'prefab') {
        // A prefab prop is a `.prefab.xml` file path (no `#`); the file itself is
        // resolved, compiled, and checked at compile time (with its own diagnostics).
        this.validatePrefabAttr(el, attr, raw);
      } else {
        this.recordReference(el, attr, raw, meta.type);
      }
    }
    for (const [attr, meta] of props) {
      if (meta.required && !el.attributes.has(attr)) {
        this.error(el, 'missing-attr', `<${el.tag}> is missing required property "${attr}"`);
      }
    }
  }

  /** Record a `#id` reference for resolution once the whole tree is known. */
  private recordReference(
    el: SceElement,
    attr: string,
    raw: string,
    declared: ComponentCtor | 'node',
  ): void {
    const value = raw.trim();
    if (value === '') return; // optional, left unset
    if (!value.startsWith('#')) {
      this.error(el, 'ref-missing-hash', `<${el.tag}> "${attr}" must reference an id with a leading "#" (e.g. "#turbine")`);
      return;
    }
    this.pendingRefs.push({ element: el, attr, value: value.slice(1), declared });
  }

  /** A `prefab` prop must name a file; `#id` here is almost always a mistake. */
  private validatePrefabAttr(el: SceElement, attr: string, raw: string): void {
    const value = raw.trim();
    if (value === '') return; // optional, left unset
    if (value.startsWith('#')) {
      this.error(el, 'bad-value', `<${el.tag}> "${attr}" is a prefab file path (e.g. "enemy.prefab.xml"), not an id reference — drop the leading "#"`);
    }
  }

  private parseScalarAttr(
    el: SceElement,
    attr: string,
    raw: string,
    type: ScalarType | EnumDef | [ScalarType | EnumDef],
  ): void {
    const result = Array.isArray(type) ? parseScalarArray(raw, type[0]) : scalarCodec(type).parse(raw);
    if (!result.ok) {
      this.error(el, 'bad-value', `<${el.tag}> attribute "${attr}": ${result.message}`);
    }
  }

  /** Validate an array-typed component property `[…]`: scalars/enums via codec, refs/prefabs per element. */
  private validateArrayAttr(el: SceElement, attr: string, raw: string, elem: PropType | ComponentCtor | EnumDef): void {
    if (isScalarType(elem) || isEnumType(elem)) {
      this.parseScalarAttr(el, attr, raw, [elem]);
      return;
    }
    const literal = parseArrayLiteral(raw);
    if (!literal.ok) {
      this.error(el, 'bad-value', `<${el.tag}> attribute "${attr}": ${literal.message}`);
      return;
    }
    literal.value.forEach((piece, i) => {
      if (elem === 'prefab') this.validatePrefabAttr(el, `${attr}[${i}]`, piece);
      else this.recordReference(el, `${attr}[${i}]`, piece, elem);
    });
  }

  private rejectChildElements(el: SceElement): void {
    for (const child of el.children) {
      this.error(child, 'unexpected-child', `<${el.tag}> may not contain child elements (found <${child.tag}>)`);
    }
  }

  private registerId(el: SceElement, raw: string, kind: 'node' | 'component'): void {
    // `/` is allowed in ids — references are literal `#id` lookups, so a scoped
    // id like `t1/osc` (from prefab expansion, or authored) is unambiguous.
    const existing = this.ids.get(raw);
    if (existing) {
      this.error(el, 'duplicate-id', `Duplicate id "${raw}" (first used at line ${existing.el.line})`);
      return;
    }
    this.ids.set(raw, { el, kind });
  }

  resolveReferences(): void {
    for (const ref of this.pendingRefs) {
      const entry = this.ids.get(ref.value);
      if (!entry) {
        this.error(ref.element, 'unresolved-ref', `<${ref.element.tag}> "${ref.attr}" references "#${ref.value}", which has no matching id`);
        continue;
      }
      if (ref.declared === 'node') {
        if (entry.kind !== 'node') {
          this.error(ref.element, 'ref-type-mismatch', `<${ref.element.tag}> "${ref.attr}" expects a node, but "#${ref.value}" is a component`);
        }
        continue;
      }
      this.resolveComponentRef(ref, ref.declared, entry);
    }
  }

  private resolveComponentRef(ref: PendingRef, declared: ComponentCtor, entry: IdEntry): void {
    if (entry.kind === 'component') {
      const compEntry = Registry.getComponent(entry.el.tag);
      if (compEntry && !isAssignable(compEntry.ctor, declared)) {
        this.error(ref.element, 'ref-type-mismatch', `<${ref.element.tag}> "${ref.attr}" expects a ${declared.name}, but "#${ref.value}" is a ${entry.el.tag}`);
      }
      return;
    }
    // The id names a node: resolve to a component of the declared type on it.
    const matches = (this.componentsByNode.get(entry.el) ?? []).filter((c) => isAssignable(c, declared));
    if (matches.length === 0) {
      this.error(ref.element, 'unresolved-ref', `<${ref.element.tag}> "${ref.attr}" expects a ${declared.name} on node "#${ref.value}", but that node has none`);
    } else if (matches.length > 1) {
      this.error(ref.element, 'ambiguous-ref', `<${ref.element.tag}> "${ref.attr}": node "#${ref.value}" has multiple ${declared.name} components — give the target component its own id and reference that`);
    }
  }
}

function isAssignable(actual: ComponentCtor, declared: ComponentCtor): boolean {
  return actual === declared || actual.prototype instanceof declared;
}

/** Required attachment groups for a node (e.g. a <Mesh> requires a 'geometry'). */
function requiredGroupsFor(node: NodeDef): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const d of allAttachmentDefs()) {
    if (!d.required || !attachmentAcceptsNode(d, node)) continue;
    (groups.get(d.group) ?? groups.set(d.group, []).get(d.group)!).push(d.tag);
  }
  return groups;
}

/** A fix-it hint listing the node tags an attachment can attach to. */
function targetHint(attDef: AttachmentDef): string {
  const tags = nodeTags().filter((t) => attachmentAcceptsNode(attDef, getNodeDef(t)!));
  return tags.length > 0 ? ` (it attaches to ${tags.map((t) => `<${t}>`).join(', ')})` : '';
}

/** XML namespace bookkeeping (xmlns, xsi:*) — used to wire an XSD, ignored by us. */
function isNamespaceAttr(name: string): boolean {
  return name === 'xmlns' || name.startsWith('xmlns:') || name.startsWith('xsi:');
}
