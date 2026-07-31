// The seam for *package-owned* `src=` document formats. A component can point
// `src=` at a file in a package-defined grammar (e.g. a particle system's
// `.particle.xml`); the owning package describes that format here, including the
// build-time compiler that turns the document into a plain JSON `config` blob.
// This compiler resolves the file and delegates — it never learns the format.
// The blob rides the bundle (see CompiledComponent.config) and reaches the live
// component via `applyConfig`.
//
// This lives in the compiler, not core, for two reasons. Every consumer is here
// (compile.ts, Validator.ts, exporters/xsd.ts) — core's runtime never reads it.
// And a format compiler is build-time code: when the seam lived in core, a tag
// package registered its document compiler from its *runtime* entry, which pinned
// the whole thing into every game bundle (invariant 2). A package now ships it
// from a separate build-time entry that the runtime entry never imports.
//
// The registration is a *description of a document type*, not just a function, so
// tooling can enumerate the formats a project has available: `scenoco new
// particle` and `scenoco validate foo.particle.xml` are generated views of this,
// exactly as the XSD and the runtime are views of the tag registry.

import type { SncElement } from './SceneParser.js';

/**
 * A parsed XML element handed to a src-document compiler — parser-agnostic, so a
 * package can walk the tree without importing this package's parser (it depends
 * on these types only, and only for typing: `import type`, erased at build).
 */
export interface ParsedElement {
  tag: string;
  attributes: Record<string, string>;
  children: ParsedElement[];
}

/** A diagnostic a src-document compiler emits (positions are added by the caller). */
export interface SrcDiagnostic {
  message: string;
  /** Stable machine-readable category, e.g. "particle-bad-shape". */
  code?: string;
}

/** What a src-document compiler returns: the config blob + any diagnostics. */
export interface SrcCompileResult {
  /** The compiled config (plain JSON) carried in the bundle; undefined if it failed. */
  config?: unknown;
  diagnostics?: SrcDiagnostic[];
}

/** Compiles a component's `src=` document (its root element) into a config blob. */
export type SrcCompiler = (root: ParsedElement, ctx: { file: string }) => SrcCompileResult;

/**
 * A package-owned `src=` document format, in full. A tag package exports one of
 * these as `srcDocument` from its build-time entry (`<pkg>/compiler`); see
 * `collectedSrcDocuments` in components.ts for how they are discovered.
 */
export interface SrcDocumentDef {
  /** The component type whose `src=` this document feeds, e.g. `ParticleSystem`. */
  component: string;
  /** File suffix identifying the format, e.g. `.particle.xml`. `new`/`validate` key off it. */
  extension: string;
  /** The document's required root element. */
  root: string;
  /** Mandatory one-line summary of the format (read by people, agents, and `scenoco new`). */
  description: string;
  /** Project-relative directory `scenoco new` writes these into, e.g. `assets/vfx`. */
  dir: string;
  /** Build-time compiler for the document. */
  compile: SrcCompiler;
  /** A minimal, valid starter document — what `scenoco new <kind> <name>` writes. */
  template(name: string): string;
}

/** Adapt a parsed element to the parser-agnostic shape a src-compiler receives. */
export function toParsedElement(el: SncElement): ParsedElement {
  return {
    tag: el.tag,
    attributes: Object.fromEntries(el.attributes),
    children: el.children.map(toParsedElement),
  };
}

/** The `new` sub-command name for a format: `.particle.xml` → `particle`. */
export function srcDocumentKind(def: SrcDocumentDef): string {
  return def.extension.replace(/^\./, '').replace(/\.xml$/, '');
}

// ---- registry ---------------------------------------------------------------
// Populated by `registerPackages` (components.ts) as it imports each tag
// package's build-time entry; read by compile.ts, Validator.ts, the XSD exporter
// and the CLI. Kept here rather than in components.ts so the dsl never has to
// import the loader.

const registry = new Map<string, SrcDocumentDef>();

/**
 * Register a package-owned `src=` document format. Last registration wins rather
 * than throwing: a watch/dev server re-imports a package's module when it
 * changes, and a duplicate-registration error there would kill the process over
 * a no-op re-registration.
 */
export function registerSrcDocument(def: SrcDocumentDef): void {
  registry.set(def.component, def);
}

/** The document format registered for a component type, or undefined. */
export function getSrcDocument(componentType: string): SrcDocumentDef | undefined {
  return registry.get(componentType);
}

/** The src-compiler registered for a component type, or undefined. */
export function getSrcCompiler(componentType: string): SrcCompiler | undefined {
  return registry.get(componentType)?.compile;
}

/** Every registered format, sorted by extension — stable tooling output. */
export function allSrcDocuments(): SrcDocumentDef[] {
  return [...registry.values()].sort((a, b) => a.extension.localeCompare(b.extension));
}

/** The format that owns a file path, matched on its extension (`vfx/a.particle.xml`). */
export function srcDocumentForFile(path: string): SrcDocumentDef | undefined {
  return allSrcDocuments().find((d) => path.endsWith(d.extension));
}
