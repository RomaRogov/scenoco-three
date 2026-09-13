import type { ComponentInfo, ProjectModel, TagInfo } from '../model.js';
import { hint, nearestName, type SncDiagnostic } from '../dsl/diagnostics.js';
import type { SncElement } from '../dsl/parse.js';
import { quote, type EmitContext } from '../dsl/value.js';
import { AssetScope, type ResolveAsset } from './assets.js';
import { TsModule, sanitizeIdentifier } from './module.js';

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
  readonly componentsById = new Map<string, { reference: string; typeName: string }>();
  readonly context: EmitContext;
  /** Resolves every asset path this document writes, and records what has to be awaited. */
  readonly assets: AssetScope;

  private locals = 0;

  constructor(module: TsModule, options: GraphOptions) {
    this.module = module;
    this.options = options;
    this.assets = new AssetScope(module, options.resolveAsset);
    this.context = {
      require: (m, n) => module.require(m, n),
      nodeRef: (id) => this.byId.get(id)?.reference ?? this.componentsById.get(id)?.reference,
      assetRef: (href) => this.assets.reference(href),
    };
  }

  /** Give an element a name in the generated code, keyed by its `id` when it has one. */
  place(element: SncElement, typeName: string, tag?: TagInfo): Placed {
    const id = element.attributes.get('id');
    const reference = id ? `this.${sanitizeIdentifier(id)}` : `node${++this.locals}`;
    const placed: Placed = { element, reference, typeName, ...(tag ? { tag } : {}) };
    this.byElement.set(element, placed);
    if (id) {
      if (this.byId.has(id)) {
        this.report(element, 'duplicate-id', `id="${id}" is used more than once in this document.`);
      }
      this.byId.set(id, placed);
    }
    return placed;
  }

  placedFor(element: SncElement): Placed | undefined {
    return this.byElement.get(element);
  }

  /** `this.paddle` needs no `const`; an anonymous node does. */
  declaration(placed: Placed): string {
    return placed.reference.startsWith('this.') ? placed.reference : `const ${placed.reference}`;
  }

  tagFor(element: SncElement, family: TagInfo['family']): TagInfo | undefined {
    const tag = this.options.model.tags.find((t) => t.name === element.tag);
    if (tag && tag.family === family) return tag;
    const candidates = this.options.model.tags.filter((t) => t.family === family).map((t) => t.name);
    const advice = hint({ near: nearestName(element.tag, candidates), as: 'tag', ask: element.tag });
    this.report(element, 'unknown-tag', `<${element.tag}> is not a ${family} tag.${advice.text}`, advice.ask);
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
  componentFields(): string[] {
    return [...this.componentsById.values()].map(
      (entry) => `${entry.reference.replace(/^this\./, '')}!: ${entry.typeName};`,
    );
  }

  report(element: SncElement, code: string, message: string, ask?: string): void {
    this.module.report(diagnostic(element, code, message, ask));
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
