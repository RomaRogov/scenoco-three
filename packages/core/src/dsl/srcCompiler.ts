// A minimal seam for *package-owned* `src=` document formats. A component can
// point `src=` at a file in a package-defined grammar (e.g. a particle system's
// `.particle.xml`); the owning package registers a build-time compiler here that
// turns that document into a plain JSON `config` blob. The core compiler resolves
// the file and delegates to the registered compiler — it never learns the format.
// The blob rides the bundle (see CompiledComponent.config) and reaches the live
// component via `applyConfig`.

/**
 * A parsed XML element handed to a src-document compiler — parser-agnostic, so a
 * package (which only depends on core) can walk the tree without importing the
 * compiler's parser.
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

const registry = new Map<string, SrcCompiler>();

/**
 * Register the build-time compiler for a component type's `src=` document. A tag
 * package calls this on import (a side effect, like registering the tag itself),
 * so the core compiler can delegate that component's `src=` to it.
 */
export function registerSrcCompiler(componentType: string, compiler: SrcCompiler): void {
  registry.set(componentType, compiler);
}

/** The src-compiler registered for a component type, or undefined. */
export function getSrcCompiler(componentType: string): SrcCompiler | undefined {
  return registry.get(componentType);
}
