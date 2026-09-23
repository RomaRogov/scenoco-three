import type { ComponentInfo, ProjectModel, TagInfo } from '../model.js';
import type { ConfigShape } from '../scan/interfaces.js';
import { hint, nearestName, type SncDiagnostic } from '../dsl/diagnostics.js';
import type { SncElement } from '../dsl/parse.js';
import { quote, type EmitContext } from '../dsl/value.js';
import { AssetScope, type ResolveAsset } from './assets.js';
import { TsModule, sanitizeIdentifier, type Origin } from './module.js';

/** One config type a package declares: its vocabulary, and where the type itself is imported from. */
export interface ConfigType {
  shape: ConfigShape;
  /** The package specifier that exports it — `@scenoco-three/particles`. */
  module: string;
}

export interface GraphOptions {
  /** `scene` roots at `<Scene>`; `prefab` roots at the node the prefab produces. */
  kind: 'scene' | 'prefab';
  /** Exported class name. */
  name: string;
  /** Path of the source document, for the banner and for diagnostics. */
  source: string;
  model: ProjectModel;
  /** Resolve an `href` written in this document to a generated module or a raw file. */
  resolveAsset: ResolveAsset;
  /**
   * The config types this project's packages declare, by type name — what a document may write
   * *inside* an element rather than point at. Absent when the shapes were never read, and an
   * element that would have filled one then reports that rather than compiling to nothing.
   */
  configs?: ReadonlyMap<string, ConfigType>;
  /**
   * Installed packages this compiler reads no vocabulary from, because they declare no `"scenoco"`
   * block. Named once beside the first thing they might explain — see {@link EmitScope.moduleHint}.
   */
  plainPackages?: readonly string[];
  /** The project root, so a diagnostic can name a source file the way the rest of them do. */
  root?: string;
  /**
   * Stamp every node with the document and line it came from, for the editor.
   *
   * Off by default and on only while a dev server is serving: it is worth a `userData` write per
   * node to be able to click a mesh and land on the element that made it, and worth nothing at
   * all in a shipped build.
   */
  provenance?: boolean;
}

/** One node the document declared, and how generated code reaches it. */
export interface Placed {
  element: SncElement;
  /** The expression that names it: `this.paddle` for an `id`, a local `const` otherwise. */
  reference: string;
  /** Set when the node came from `<Prefab>`, so its type is the prefab class. */
  typeName: string;
  tag?: TagInfo;
}

/**
 * What every part of emitting one document shares: the module being written, the project model,
 * and the index of what has been named so far.
 *
 * Compiling a document is half a dozen unrelated jobs — building the tree, spawning prefabs,
 * attaching components, adding systems, reading the scene's own attributes — and they have
 * almost nothing in common *except* this. It used to be one 780-line class in which they were
 * all methods, so every new feature made the same file longer and the boundaries between the
 * jobs existed only as comment banners. Passing the shared state explicitly is what lets each
 * job be a module you can read on its own.
 */
export class EmitScope {
  readonly module: TsModule;
  readonly options: GraphOptions;
  /** Nodes with an `id`, which is what `#id` resolves against. */
  readonly byId = new Map<string, Placed>();
  /** Every node this document declares, id'd or not — an unnamed node carries components too. */
  readonly byElement = new Map<SncElement, Placed>();
  /** Component instances that carry an `id`, so a document can reference one directly. */
  readonly componentsById = new Map<string, { reference: string; typeName: string; element: SncElement }>();
  readonly context: EmitContext;
  /** Resolves every asset path this document writes, and records what has to be awaited. */
  readonly assets: AssetScope;

  private locals = 0;
  /** The "these are not modules" note is worth saying once per document, not once per element. */
  private hinted = false;
  /**
   * Which element each stretch of a pending buffer came from.
   *
   * The emitters fill plain string arrays and `emitGraph` pours them into the module in a
   * different order than they were written, so a line cannot be blamed as it is written. Each
   * emitter marks the buffer once on the way in instead, and {@link pour} turns those marks into
   * the module's own line map. That map is what lets a `tsc` error in generated code be reported
   * at the element that caused it.
   */
  private readonly marks = new WeakMap<string[], Array<{ at: number; origin: Origin }>>();

  constructor(module: TsModule, options: GraphOptions) {
    this.module = module;
    this.options = options;
    this.assets = new AssetScope(module, options.resolveAsset);
    this.context = {
      require: (m, n) => module.require(m, n),
      nodeRef: (id, expected) => this.resolveRef(id, expected),
      assetRef: (href) => this.assets.reference(href),
      nearAsset: (href) => this.assets.near(href),
      assetType: (href) => this.assets.typeOf(href),
      tags: options.model.tags,
    };
  }

  /**
   * What `#id` means in a slot. A node, or a component with that id — and, when the slot is typed
   * as a component and the id names a node, the component that node carries: Unity's inspector
   * does the same when an object is dropped on a component field. Before this, the node itself
   * went into the slot and `tsc` complained about the generated file, not the document.
   */
  private resolveRef(id: string, expected?: string): { code: string } | { problem: string } | undefined {
    const placed = this.byId.get(id);
    if (!placed) {
      const component = this.componentsById.get(id);
      return component ? { code: component.reference } : undefined;
    }
    const model = this.options.model;
    const wanted = expected ? [...model.components, ...model.effects].find((c) => c.name === expected) : undefined;
    if (!wanted) return this.nodeOfClass(id, placed, expected);
    // The node *is* one — a UI element is a node and is scanned as a component too.
    const nodeClass = placed.tag?.name ?? placed.typeName;
    if (nodeClass === wanted.name || placed.tag?.bases.includes(wanted.name)) return { code: placed.reference };
    // A spawn's components live in its prefab, which this document cannot see; `tsc` has the type.
    const spawned = placed.element.tag === 'Prefab';
    const carried = placed.element.children
      .filter((child) => child.tag === 'Components')
      .some((block) => block.children.some((c) => c.tag === wanted.name));
    if (!spawned && !carried) {
      return {
        problem:
          `names a <${nodeClass}> that carries no <${wanted.name}>, and the slot takes a ${wanted.name}. ` +
          `Add <${wanted.name} /> to its <Components>, or point at a node that has one.`,
      };
    }
    const local = this.module.require(moduleFor(wanted), wanted.name);
    return { code: `${placed.reference}.getComponent(${local})!` };
  }

  /**
   * A slot typed as a *node* class — `mesh!: Mesh`, `light!: PointLight` — filled with an `#id`.
   *
   * `tsc` catches the mismatch, but its answer is the five structural properties a
   * `PerspectiveCamera` is missing from `Mesh<BufferGeometry<NormalBufferAttributes, …>>`, which
   * says what is wrong and nothing about what to do. The document knows both classes by name.
   */
  private nodeOfClass(id: string, placed: Placed, expected?: string): { code: string } | { problem: string } {
    const tag = expected ? this.options.model.tags.find((t) => t.name === expected && t.family === 'node') : undefined;
    // A spawn's class is the prefab's, which this document cannot see; `tsc` has the type.
    if (!tag || placed.element.tag === 'Prefab') return { code: placed.reference };
    const is = placed.tag?.name ?? placed.typeName;
    if (is === tag.name || placed.tag?.bases.includes(tag.name)) return { code: placed.reference };
    return {
      problem:
        `points at <${is} id="${id}">, and the slot is typed ${tag.name}. Point it at a ` +
        `${tag.name}, or type the field Object3D, which every node is.`,
    };
  }

  /** Give an element a name in the generated code, keyed by its `id` when it has one. */
  place(element: SncElement, typeName: string, tag?: TagInfo): Placed {
    const id = element.attributes.get('id');
    const reference = id ? `this.${sanitizeIdentifier(id)}` : `node${++this.locals}`;
    const placed: Placed = { element, reference, typeName, ...(tag ? { tag } : {}) };
    this.byElement.set(element, placed);
    if (id) {
      this.claimId(element, id);
      this.byId.set(id, placed);
    }
    return placed;
  }

  /** The lines `out` takes from here on were written for `element`. */
  from(out: string[], element: SncElement): void {
    let marks = this.marks.get(out);
    if (!marks) this.marks.set(out, (marks = []));
    const origin: Origin = { line: element.line, column: element.column };
    marks.push({ at: out.length, origin });
    // Imports are written as they are needed rather than buffered, so the module is told directly.
    this.module.now(origin);
  }

  /** Write a buffer into the module, carrying its marks over as the module's line map. */
  pour(out: readonly string[]): void {
    const marks = this.marks.get(out as string[]) ?? [];
    let next = 0;
    for (let i = 0; i < out.length; i++) {
      while (next < marks.length && marks[next]!.at <= i) this.module.claim(this.module.written, marks[next++]!.origin);
      this.module.line(out[i]!);
    }
  }

  /**
   * Check an `id` before anything is named after it — it becomes a field on the generated class.
   *
   * Both failures here are a *silent* wrong answer otherwise. A repeated id compiles to two
   * fields of one name, so the second wins and whatever pointed at the first reaches the wrong
   * object; an id that a base already declares redeclares it with a node's type, which stops the
   * class compiling at a line nobody wrote.
   */
  claimId(element: SncElement, id: string): void {
    const taken = this.byId.get(id) ?? this.componentsById.get(id);
    if (taken && taken.element !== element) {
      this.report(
        element,
        'duplicate-id',
        `id="${id}" is already on the <${taken.element.tag}> at line ${taken.element.line}. An id names one ` +
          'thing in a document — components and nodes share the one set of names, because both ' +
          'become a field of that name on the generated class.',
      );
      return;
    }
    if (this.reserved.has(id)) {
      this.report(
        element,
        'reserved-id',
        `id="${id}" is already a property of ${this.baseName}, which this document's class ` +
          `extends — so the id would redeclare it. Pick another, such as id="${id}Node".`,
      );
    }
  }

  /**
   * A class a document names that generated code cannot import.
   *
   * Generated code writes `import { Spawner } from './Spawner.js'`, so a class declared without
   * `export` — or exported as the default — is an import of a name that is not there. It is the
   * one authoring mistake whose fix is in a `.ts` file rather than in the document, which is
   * exactly why the message has to say which file and what to write in it.
   */
  checkExported(element: SncElement, info: ComponentInfo): void {
    if (!info.unexported) return;
    const fix =
      info.unexported === 'default'
        ? `Export it by name instead: \`export class ${info.name} …\` — generated code imports it by name.`
        : `Write \`export class ${info.name} …\`.`;
    this.report(
      element,
      'not-exported',
      `<${info.name}> is declared in ${this.fileName(info.file)}:${info.line}, but a document ` +
        `cannot reach it. ${fix}`,
    );
  }

  /** A project file, named from the project root the way every other diagnostic names one. */
  private fileName(file: string): string {
    const root = this.options.root;
    return root && file.startsWith(root) ? file.slice(root.length).replace(/^[/\\]/, '') : file;
  }

  /** The class a document's generated class extends: `Scene`, or a prefab's root tag. */
  private baseName = 'Scene';
  private reserved: ReadonlySet<string> = new Set();

  /** Told once, by the emitter that knows what the generated class is rooted at. */
  rootedAt(tag: TagInfo | undefined): void {
    const name = tag?.name ?? 'Scene';
    const base = this.options.model.tags.find((t) => t.name === name);
    this.baseName = name;
    this.reserved = new Set(base?.members ?? []);
  }

  placedFor(element: SncElement): Placed | undefined {
    return this.byElement.get(element);
  }

  /** `this.paddle` needs no `const`; an anonymous node does. */
  declaration(placed: Placed): string {
    return placed.reference.startsWith('this.') ? placed.reference : `const ${placed.reference}`;
  }

  /**
   * What a name is and where it goes, when it was written where another kind goes —
   * `<SphereCollider>` in the tree, `<Game>` in a node's `<Components>`, a component in
   * `<Systems>`. One answer for every place, read off what the project declares.
   */
  misplaced(name: string, wanted: 'node' | 'component' | 'system'): string | undefined {
    const model = this.options.model;
    const is = model.components.some((c) => c.name === name)
      ? 'component'
      : model.systems.some((s) => s.name === name)
        ? 'system'
        : model.tags.some((t) => t.name === name && t.family === 'node')
          ? 'node'
          : undefined;
    if (!is || is === wanted) return undefined;
    const where = {
      component: `in a node's <Components>, as <Mesh …><Components><${name} /></Components></Mesh>`,
      system: "in the scene's <Systems>",
      node: 'in the tree, as an element of its own',
    }[is];
    return `<${name}> is a ${is}, not a ${wanted}: it goes ${where}.`;
  }

  tagFor(element: SncElement, family: TagInfo['family']): TagInfo | undefined {
    const tag = this.options.model.tags.find((t) => t.name === element.tag);
    if (tag && tag.family === family) return tag;
    const candidates = this.options.model.tags.filter((t) => t.family === family).map((t) => t.name);
    const elsewhere = family === 'node' ? this.misplaced(element.tag, 'node') : undefined;
    if (elsewhere) {
      this.report(element, 'unknown-tag', elsewhere);
      return undefined;
    }
    const advice = hint({ near: nearestName(element.tag, candidates), as: 'tag', ask: element.tag });
    this.report(
      element,
      'unknown-tag',
      `<${element.tag}> is not a ${family} tag.${advice.text}${this.moduleHint()}`,
      advice.ask,
    );
    return undefined;
  }

  /**
   * Record which element of which document built this node.
   *
   * The editor's selection model rests on this, and so does ownership: a prefab's generated code
   * stamps its nodes with the prefab's own file, so a node whose file is not the open document
   * came from somewhere else and is read-only here.
   */
  stamp(element: SncElement, target: string, out: string[]): void {
    if (!this.options.provenance) return;
    out.push(
      `${target}.userData.scenoco = { file: ${quote(this.options.source)}, ` +
        `line: ${element.line}, column: ${element.column} };`,
    );
  }

  /**
   * Class fields for the components that carry an `id`.
   *
   * Without these the emitter would write `this.scoreboard = …addComponent(…)` against a field
   * nothing declared — a `tsc` error inside generated code, which is the worst place to meet
   * one. A component id is as much a handle as a node id, so it gets the same treatment.
   */
  componentFields(into: string[]): void {
    for (const entry of this.componentsById.values()) {
      this.from(into, entry.element);
      into.push(`${entry.reference.replace(/^this\./, '')}!: ${entry.typeName};`);
    }
  }

  report(element: SncElement, code: string, message: string, ask?: string): void {
    this.module.report(diagnostic(element, code, message, ask));
  }

  /**
   * Why a name this project clearly ships might still be unknown here.
   *
   * A package is read for tags only when it declares itself a module. One that does not is
   * installed, importable and typechecks — and contributes no vocabulary, so the honest message is
   * not "there is no such tag" but "nothing reads that package". Said once, then dropped.
   */
  moduleHint(): string {
    const plain = this.options.plainPackages ?? [];
    if (this.hinted || plain.length === 0) return '';
    this.hinted = true;
    const names = plain.map((name) => `"${name}"`).join(', ');
    const is = plain.length > 1 ? 'are dependencies' : 'is a dependency';
    return ` (${names} ${is} of this project declaring no "scenoco" block, so no tags or components are read from ${plain.length > 1 ? 'them' : 'it'}.)`;
  }
}

/** The identifier a placed node gets as a class field. */
export function identifier(placed: Placed): string {
  return placed.reference.replace(/^this\./, '');
}

/**
 * Where a component or system is imported from.
 *
 * A package says so itself (`@scenoco-three/box2d`). A project's own class is named by its
 * absolute path here, and the build driver rewrites that to a path relative to the generated
 * file — the only place that knows where the output lands.
 */
export function moduleFor(component: ComponentInfo): string {
  return component.module ?? component.file;
}

export function diagnostic(
  element: SncElement,
  code: string,
  message: string,
  ask?: string,
): SncDiagnostic {
  return {
    line: element.line,
    column: element.column,
    code,
    message,
    ...(element.file ? { file: element.file } : {}),
    ...(ask !== undefined ? { ask } : {}),
  };
}
