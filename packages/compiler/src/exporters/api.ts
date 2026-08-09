import {
  Registry,
  allNodeDefs,
  allAttachmentDefs,
  attachmentsForNode,
  attachmentAcceptsNode,
  allSystemDefs,
  builtinNodeModules,
  isArrayType,
  isEnumType,
  elementType,
  TRANSFORM_ATTRS,
  type ComponentCtor,
  type PropertyMeta,
  type NodeAttr,
  type NodeDef,
  type AttachmentDef,
} from '@scenoco-three/core/internal';
import { ValueType } from '@scenoco-three/core/internal';
import { isAbsolute, relative, sep } from 'node:path';

import { codecs, type ScalarType } from '../dsl/types.js';

/** Bump on any breaking change to the exported shape below. */
const SCHEMA_VERSION = 1;

/**
 * Machine-readable description of the scene language: every node, attachment,
 * component and system with its typed attributes, plus the relations between
 * them (component references, node↔attachment compatibility, system→component).
 *
 * Built from the same registries as the runtime and the XSD, so it never drifts.
 * Pure structured data — no prose, examples, or agent guidance. Consumers (editor
 * tooling, a graph-RAG index, validators) derive their own views from this.
 */
export interface SceneApi {
  schemaVersion: number;
  /** Canonical XML text format for each scalar attribute type. */
  valueTypes: Record<ScalarType, { example: string }>;
  /** Transform attributes implicitly present on every spatial node. */
  transform: Attribute[];
  nodes: NodeApi[];
  attachments: AttachmentApi[];
  components: ComponentApi[];
  systems: SystemApi[];
  /**
   * Flattened semantic edges for graph ingestion: component→target references and
   * system→component processing. Node↔attachment compatibility is intentionally
   * *not* exploded here — it lives compactly on `nodes[].accepts` (with cardinality)
   * and `attachments[].targets`, so build attach-edges from those if you need them.
   */
  relations: Relation[];
}

/** A scalar attribute on a node or attachment (math/primitive, never a reference). */
export interface Attribute {
  name: string;
  /** Element type. When `array` is true the attribute is a `[type,…]` list. */
  type: ScalarType;
  /** True for an array attribute written `[a,b,c]`. */
  array?: true;
  /**
   * For an enum-typed attribute, the member names that may be written — `type` is
   * then the enum's registered name. Carried here, not left to a lookup, because
   * `type` alone ("CameraFit") tells a reader what to call the thing but not what
   * to write; a component's enum *properties* have always listed their members,
   * and an attribute is the same question asked on a node.
   */
  values?: string[];
  default?: number | boolean | string | number[] | (number | boolean | string | number[])[];
  required: boolean;
  description?: string;
}

/**
 * Where a tag/component/system is declared, so a consumer can jump from an XML
 * tag straight to the TypeScript that defines it. Exactly one locator is set:
 * `file` for something declared in the project being exported (repo-relative,
 * POSIX separators), `package` for something a registered tag package brought in.
 */
export interface SourceRef {
  /** Project-relative path, e.g. "assets/components/Ball.ts". */
  file?: string;
  /** Package specifier, e.g. "@scenoco-three/box2d". */
  package?: string;
  /** The exported class / decorated symbol to look up in that file or package. */
  symbol: string;
}

/**
 * Tag/component/system → declaring origin. Structurally the subset of the
 * compiler's `ComponentScan` this exporter needs; each value is either an
 * absolute file path (project) or a package specifier (dependency).
 */
export interface SourceIndex {
  byName: ReadonlyMap<string, string>;
  byTag: ReadonlyMap<string, string>;
  byComponentSystem?: ReadonlyMap<string, readonly string[]>;
  /** `@system` class name → package specifier that registered it. */
  bySystem?: ReadonlyMap<string, string>;
}

export interface NodeApi {
  tag: string;
  kind: 'scene' | 'object3d';
  /** Three.js class the node builds (e.g. "Mesh"), when known. */
  produces?: string;
  description?: string;
  /** Every node also carries the shared `transform` attributes. */
  hasTransform: boolean;
  attributes: Attribute[];
  /** What the node may contain. */
  children: { object3d: boolean; components: boolean };
  /** Attachment groups the node accepts, with cardinality (the node's view of compatibility). */
  accepts: AttachmentGroupRef[];
  /**
   * A worked example, for a tag whose *shape* is the thing that has to be learned
   * rather than its attribute list. Almost no node needs this — the attribute
   * table is the documentation. `<PrefabInstance>` does, because how you change one
   * placement's values is a child element (`<Override>`) that no attribute row
   * mentions, and guessing wrong is silent (see the compiler's prefab.ts).
   */
  usage?: string[];
  /** Where the tag is declared, when the exporter was given a source index. */
  source?: SourceRef;
}

export interface AttachmentGroupRef {
  group: string;
  /** The node needs at least one attachment of this group. */
  required: boolean;
  /** At most one attachment of this group per node. */
  unique: boolean;
  /** Attachment tags that satisfy the group. */
  tags: string[];
}

export interface AttachmentApi {
  tag: string;
  group: string;
  required: boolean;
  unique: boolean;
  description?: string;
  /** Node tags this attachment can attach to. */
  targets: string[];
  attributes: Attribute[];
  source?: SourceRef;
}

export interface ComponentApi {
  name: string;
  description?: string;
  properties: PropertyApi[];
  source?: SourceRef;
}

/** A component property: either a scalar value or a typed reference to another entity. */
export type PropertyApi =
  | ({ kind: 'scalar' } & Attribute)
  | {
      kind: 'enum';
      name: string;
      /** Registered enum name (its XSD simpleType). */
      enum: string;
      /** Allowed member names — the values written in XML. */
      values: string[];
      array?: true;
      default?: Attribute['default'];
      required: boolean;
      description?: string;
    }
  | {
      kind: 'reference';
      name: string;
      references: ReferenceTarget;
      /** True for an array of references written `[#a,#b]`. */
      array?: true;
      required: boolean;
      description?: string;
    };

/** What a reference property resolves to (the `to` side of a `references` edge). */
export type ReferenceTarget =
  | { entity: 'component'; name: string } // typed component reference, by #id
  | { entity: 'node' } // any Object3D, by #id
  | { entity: 'prefab' }; // a .prefab.xml file, spawnable at runtime

export interface SystemApi {
  /** System class name. */
  name: string;
  /** Registered component tag the system queries. */
  processes?: string;
  source?: SourceRef;
}

/** Identifies an entity on either side of a relation. */
export interface EntityRef {
  entity: 'node' | 'attachment' | 'component' | 'system';
  name: string;
}

/** A typed semantic edge between two entities — the graph-RAG-friendly view. */
export type Relation =
  | { kind: 'references'; from: EntityRef; via: string; to: ReferenceTarget; array?: true }
  | { kind: 'processes'; from: EntityRef; to: EntityRef };

/**
 * Options for the exporters. Pass `sources` (the `ComponentScan` from
 * `loadComponents`) to attach a `source` locator to every tag, component and
 * system — the link from an XML tag to the TypeScript that declares it. Omit it
 * and the output is exactly as before, minus the `source` fields.
 */
export interface ApiOptions {
  sources?: SourceIndex;
  /** Root that `source.file` paths are relative to. Defaults to `process.cwd()`. */
  cwd?: string;
}

/** Build the scene API model from the live registries. */
export function generateApi(opts: ApiOptions = {}): SceneApi {
  const src = opts.sources;
  const cwd = opts.cwd ?? process.cwd();
  const locate = (origin: string | undefined, symbol: string): SourceRef | undefined =>
    origin === undefined ? undefined : sourceRef(origin, symbol, cwd);
  // Built-in tags are registered by core itself, so they never appear in a scan.
  // `builtinNodeModules` is the authoritative tag → module map (kept in sync by
  // tests/treeshake.test.ts), which makes every built-in locatable too.
  const locateTag = (tag: string): SourceRef | undefined =>
    locate(src?.byTag.get(tag) ?? builtinNodeModules[tag], tag);
  const valueTypes = Object.fromEntries(
    (Object.keys(codecs) as ScalarType[]).map((t) => [t, { example: codecs[t].example }]),
  ) as Record<ScalarType, { example: string }>;

  const transform = Object.entries(TRANSFORM_ATTRS).map(([name, meta]) => attribute(name, meta));

  const nodeDefs = allNodeDefs();
  const nodes = [
    ...nodeDefs
      .slice()
      .sort(byKindThenTag)
      .map((def) => withSource(nodeApi(def), locateTag(def.tag))),
    prefabInstanceApi(),
  ];

  const attachments = allAttachmentDefs()
    .slice()
    .sort((a, b) => a.group.localeCompare(b.group) || a.tag.localeCompare(b.tag))
    .map((def) => withSource(attachmentApi(def, nodeDefs), locateTag(def.tag)));

  const components = Registry.componentNames()
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .map((name) => withSource(componentApi(name), locate(src?.byName.get(name), name)));

  const systems = allSystemDefs()
    .map((def) => {
      const processes = componentNameOf(def.componentType as ComponentCtor);
      // A system is indexed by the component type it processes, and may be
      // declared in more than one file; the first is the canonical declaration.
      // Prefer the package that registered the system class; fall back to the
      // project file(s) declaring a `@system` for the component it processes.
      const origin =
        src?.bySystem?.get(def.ctor.name) ??
        (processes ? src?.byComponentSystem?.get(processes)?.[0] : undefined);
      return withSource(
        { name: def.ctor.name, ...(processes ? { processes } : {}) },
        locate(origin, def.ctor.name),
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    schemaVersion: SCHEMA_VERSION,
    valueTypes,
    transform,
    nodes,
    attachments,
    components,
    systems,
    relations: buildRelations(components, systems),
  };
}

/** Pretty-printed JSON of the scene API (diff-friendly artifact). */
export function generateApiJson(opts: ApiOptions = {}): string {
  return JSON.stringify(generateApi(opts), null, 2) + '\n';
}

/** Attach a `source` only when one is known, so the field is absent, never null. */
function withSource<T extends object>(entry: T, source: SourceRef | undefined): T {
  return source ? { ...entry, source } : entry;
}

/**
 * An absolute path means the project declares it → repo-relative `file`.
 * Anything else is a package specifier as written in `package.json`.
 */
function sourceRef(origin: string, symbol: string, cwd: string): SourceRef {
  return isAbsolute(origin)
    ? { file: relative(cwd, origin).split(sep).join('/'), symbol }
    : { package: origin, symbol };
}

// ---- builders ---------------------------------------------------------------

function nodeApi(def: NodeDef): NodeApi {
  const groups = new Map<string, AttachmentDef[]>();
  for (const a of attachmentsForNode(def)) {
    (groups.get(a.group) ?? groups.set(a.group, []).get(a.group)!).push(a);
  }
  return {
    tag: def.tag,
    kind: def.kind,
    ...(def.produces?.name ? { produces: def.produces.name } : {}),
    ...(def.description ? { description: def.description } : {}),
    hasTransform: true,
    attributes: Object.entries(def.attrs).map(([name, meta]) => attribute(name, meta)),
    children: { object3d: def.children.object3d, components: def.children.components },
    accepts: [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, defs]) => ({
        group,
        required: defs[0]!.required,
        unique: defs[0]!.unique,
        tags: defs.map((d) => d.tag).sort(),
      })),
  };
}

function attachmentApi(def: AttachmentDef, nodeDefs: NodeDef[]): AttachmentApi {
  return {
    tag: def.tag,
    group: def.group,
    required: def.required,
    unique: def.unique,
    ...(def.description ? { description: def.description } : {}),
    targets: nodeDefs.filter((n) => attachmentAcceptsNode(def, n)).map((n) => n.tag).sort(),
    attributes: Object.entries(def.attrs).map(([name, meta]) => attribute(name, meta)),
  };
}

function componentApi(name: string): ComponentApi {
  const meta = Registry.getComponent(name)!.meta;
  return {
    name,
    ...(meta.description ? { description: meta.description } : {}),
    properties: [...meta.properties].map(([attr, prop]) => propertyApi(attr, prop)),
  };
}

function attribute(name: string, meta: NodeAttr): Attribute {
  const array = isArrayType(meta.type) ? { array: true as const } : {};
  const elem = isArrayType(meta.type) ? meta.type[0] : meta.type;
  return {
    name,
    // Enum attrs report their registered name (the XSD simpleType); scalars their type.
    type: (isEnumType(elem) ? elem.name : elem) as ScalarType,
    ...(isEnumType(elem) ? { values: elem.names } : {}),
    ...array,
    ...(meta.default !== undefined ? { default: meta.default } : {}),
    required: meta.required ?? false,
    ...(meta.description ? { description: meta.description } : {}),
  };
}

function propertyApi(name: string, meta: PropertyMeta): PropertyApi {
  const required = meta.required ?? false;
  const description = meta.description ? { description: meta.description } : {};
  const array = isArrayType(meta.type) ? { array: true as const } : {};
  const elem = elementType(meta.type);
  if (isEnumType(elem)) {
    return {
      kind: 'enum',
      name,
      enum: elem.name,
      values: elem.names,
      ...array,
      ...(meta.default !== undefined ? { default: meta.default } : {}),
      required,
      ...description,
    };
  }
  if (typeof elem !== 'string') {
    const target = componentNameOf(elem) ?? elem.name;
    return { kind: 'reference', name, references: { entity: 'component', name: target }, ...array, required, ...description };
  }
  if (elem === ValueType.Node) {
    return { kind: 'reference', name, references: { entity: 'node' }, ...array, required, ...description };
  }
  if (elem === ValueType.Prefab) {
    return { kind: 'reference', name, references: { entity: 'prefab' }, ...array, required, ...description };
  }
  return {
    kind: 'scalar',
    name,
    type: elem,
    ...array,
    ...(meta.default !== undefined ? { default: meta.default } : {}),
    required,
    ...description,
  };
}

function buildRelations(components: ComponentApi[], systems: SystemApi[]): Relation[] {
  const relations: Relation[] = [];
  for (const c of components) {
    for (const p of c.properties) {
      if (p.kind === 'reference') {
        relations.push({
          kind: 'references',
          from: { entity: 'component', name: c.name },
          via: p.name,
          to: p.references,
          ...(p.array ? { array: true as const } : {}),
        });
      }
    }
  }
  for (const s of systems) {
    if (s.processes) {
      relations.push({ kind: 'processes', from: { entity: 'system', name: s.name }, to: { entity: 'component', name: s.processes } });
    }
  }
  return relations;
}

/** The registered tag name for a component class (class name and tag can differ). */
function componentNameOf(ctor: ComponentCtor): string | undefined {
  for (const name of Registry.componentNames()) {
    if (Registry.getComponent(name)!.ctor === ctor) return name;
  }
  return undefined;
}

/** Scene root first, then object3d nodes, alphabetically within each — stable output. */
/**
 * `<PrefabInstance>` has no `NodeDef` — it is expanded away before the tree is
 * built, so nothing registers it. It is still a tag an author writes, and the
 * XSD has always emitted it, so leaving it out of the API model made
 * `scenoco which PrefabInstance` answer "not registered" about a tag this
 * project's own docs tell you to use. A lookup that dead-ends on a real tag
 * reads as "this does not exist", so the model carries it like any other node.
 */
function prefabInstanceApi(): NodeApi {
  return {
    tag: 'PrefabInstance',
    kind: 'object3d',
    description: 'Places a prefab. Expanded at build time — the prefab’s own root replaces this tag.',
    hasTransform: true,
    attributes: [
      {
        name: 'src',
        type: 'string',
        required: true,
        description: 'The .prefab.xml file to place, relative to this document',
      },
      {
        name: 'id',
        type: 'string',
        required: true,
        description: 'Names this placement. Required on every instance — its internals are addressed as "#<id>/<inner>"',
      },
    ],
    children: { object3d: false, components: true },
    accepts: [],
    // The two things that are only learnable by getting them wrong: overrides go
    // through <Override>, not <Components> (which *adds* a second component), and
    // the target is the id of the thing being patched — for a component property,
    // that component's own id, which the prefab file has to declare.
    usage: [
      '<PrefabInstance src="brick.prefab.xml" id="b1" position="x: -6.75; y: 12">',
      '  <Override target="#hp" points="20" />      <!-- patch a prefab-internal node/component by its id -->',
      '  <Components><Wobble speed="2" /></Components>   <!-- ADDS a component to this placement -->',
      '</PrefabInstance>',
      '',
      'To override a component property, that component needs an id in the prefab file:',
      '  <Components><Brick id="hp" points="10" /></Components>',
    ],
  };
}

function byKindThenTag(a: NodeDef, b: NodeDef): number {
  const rank = (k: NodeDef['kind']) => (k === 'scene' ? 0 : 1);
  return rank(a.kind) - rank(b.kind) || a.tag.localeCompare(b.tag);
}
