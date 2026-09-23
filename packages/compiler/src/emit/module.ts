import type { SncDiagnostic } from '../dsl/diagnostics.js';

/** A position in the document a generated line came from. */
export interface Origin {
  line: number;
  column: number;
}

/**
 * Builds one generated TypeScript module.
 *
 * It exists to make the output *readable*, which is the price of generating code at all: a
 * developer who lands in `brick.prefab.gen.ts` from a stack trace has to be able to see what
 * the XML said. So imports are collected and printed once at the top, names are deduplicated
 * per module, and a local rename only happens when two modules genuinely export the same name.
 */
export class TsModule {
  readonly diagnostics: SncDiagnostic[] = [];

  /** module specifier → exported name → local name. */
  private readonly imports = new Map<string, Map<string, string>>();
  /** `"<module> <name>"` for every import wanted only as a type. */
  private readonly typeOnly = new Set<string>();
  /** Modules imported purely for their side effect, printed before the named imports. */
  private readonly sideEffects = new Set<string>();
  /** Every local name in the module, so a collision is renamed rather than shadowed. */
  private readonly taken = new Set<string>();
  /** Module-scope declarations printed between the imports and the body. */
  private readonly hoisted: string[] = [];
  private readonly lines: string[] = [];
  /**
   * Where the lines from each index onward came from, in the order they were claimed.
   *
   * This is what keeps a mistake out of the generated file when `tsc` is the one that found it:
   * a type error lands on a line here, and this says which element wrote it, so the report comes
   * back at the `.xml` the reader can actually edit. Recorded always — it is a handful of numbers
   * per document, and a map that only exists in dev is a map that is missing whenever it matters.
   */
  private readonly origins: Array<{ from: number; origin: Origin }> = [];
  /** Local import name → the element that asked for it, so a bad import is blamed on the tag. */
  private readonly importOrigins = new Map<string, Origin>();
  /** Whose turn it is: set by the emitters, read by {@link require}. */
  private importing: Origin | undefined;
  /** Rendered line → origin, filled by {@link render} because the imports decide the offsets. */
  private lineOrigins = new Map<number, Origin>();
  private indentation = 0;

  private readonly banner: string;

  constructor(banner: string) {
    this.banner = banner;
  }

  /** Record a needed import and return the local name to write. */
  require(module: string, name: string): string {
    let byName = this.imports.get(module);
    if (!byName) this.imports.set(module, (byName = new Map()));
    const existing = byName.get(name);
    if (existing) {
      this.typeOnly.delete(`${module} ${name}`); // wanted as a value after all
      return existing;
    }

    let local = name;
    for (let n = 2; this.taken.has(local); n++) local = `${name}$${n}`;
    this.taken.add(local);
    byName.set(name, local);
    // A class that is declared but not exported, or one whose module moved, fails on the import
    // line rather than where it is used — so the import remembers who wanted it.
    if (this.importing) this.importOrigins.set(`${module} ${name}`, this.importing);
    return local;
  }

  /**
   * Import a name used **only as a type** — an interface a generated value is annotated with.
   *
   * It has to be spelled `import type`, because a project compiled with `verbatimModuleSyntax`
   * emits the import exactly as written: a plain import of an interface survives to runtime and
   * throws `does not provide an export named …` the moment a browser loads the file.
   */
  requireType(module: string, name: string): string {
    const local = this.require(module, name);
    this.typeOnly.add(`${module} ${name}`);
    return local;
  }

  /**
   * Import a module for its side effect alone: `import '@scenoco-three/core';`.
   *
   * Generated graph code calls `addComponent`, `instantiate` and `eulerAngles`, which are
   * augmentations on `THREE.Object3D` rather than members of it. Without this import the
   * generated file neither typechecks nor runs — the methods are simply not there.
   */
  sideEffect(module: string): this {
    this.sideEffects.add(module);
    return this;
  }

  /** Claim a local identifier that is not an import — a const, a class, a variable. */
  declare(preferred: string): string {
    let name = sanitizeIdentifier(preferred);
    for (let n = 2; this.taken.has(name); n++) name = `${sanitizeIdentifier(preferred)}$${n}`;
    this.taken.add(name);
    return name;
  }

  /**
   * Write a module-scope declaration, above the class or const this module is building.
   *
   * A file asset lands here: `const heroModel = sharedModel(new URL('./hero.glb', …).href)`.
   * It has to be one named value rather than the expression repeated at each use, because the
   * scene also has to name it in `loadAssets(…)` — and because a reader should see the file
   * list at the top of the module.
   */
  hoist(text: string): this {
    this.hoisted.push(text);
    return this;
  }

  line(text = ''): this {
    if (!text) {
      this.lines.push('');
      return this;
    }
    // A construction may be several lines — a material's options object is — so every line is
    // indented, not just the first.
    const prefix = '  '.repeat(this.indentation);
    for (const part of text.split('\n')) this.lines.push(part ? prefix + part : '');
    return this;
  }

  /** Write `header` then an indented `body`, then the closing text. */
  block(header: string, body: () => void, close = '}'): this {
    this.line(header);
    this.indentation++;
    body();
    this.indentation--;
    this.line(close);
    return this;
  }

  /** How many body lines have been written — the index the next claim starts at. */
  get written(): number {
    return this.lines.length;
  }

  /** Everything written from body line `from` onward came from `origin`, until the next claim. */
  claim(from: number, origin: Origin): this {
    this.origins.push({ from, origin });
    return this;
  }

  /** Whose element is being emitted right now — what an import written from here belongs to. */
  now(origin: Origin | undefined): this {
    this.importing = origin;
    return this;
  }

  /**
   * Rendered line number (1-based) → where in the document that line came from.
   *
   * Only valid after {@link render}, which is what fixes how many lines the banner and the
   * imports take.
   */
  origin(): ReadonlyMap<number, Origin> {
    return this.lineOrigins;
  }

  report(diagnostic: SncDiagnostic): void {
    this.diagnostics.push(diagnostic);
  }

  reportAll(diagnostics: readonly SncDiagnostic[]): void {
    this.diagnostics.push(...diagnostics);
  }

  /** The finished module source. */
  render(): string {
    const out: string[] = [this.banner, ''];
    /** Import lines, by their index in `out` — turned into file lines once the banner is counted. */
    const imported = new Map<number, Origin>();
    for (const module of [...this.sideEffects].sort()) {
      // A named import from the same module already evaluates it, so printing both is one line
      // of noise in every generated file that happens to name a class from core.
      if (this.imports.has(module)) continue;
      out.push(`import '${module}';`);
    }
    for (const module of [...this.imports.keys()].sort(sortImports)) {
      const byName = this.imports.get(module)!;
      const entries = [...byName.entries()].sort(([a], [b]) => a.localeCompare(b));
      // One line, several names: the first that has an origin owns it. Two tags from one module
      // that both went wrong is not a case worth splitting the import for.
      const owner = entries.map(([name]) => this.importOrigins.get(`${module} ${name}`)).find(Boolean);
      if (owner) imported.set(out.length + 1, owner);
      const clause = ([name, local]: [string, string]) => (name === local ? name : `${name} as ${local}`);
      const types = entries.filter(([name]) => this.typeOnly.has(`${module} ${name}`));
      // All types: `import type`, which a `verbatimModuleSyntax` build erases outright. Mixed:
      // one import with the type names marked, which erases the bindings and keeps the module.
      if (types.length === entries.length) {
        out.push(`import type { ${entries.map(clause).join(', ')} } from '${module}';`);
        continue;
      }
      const clauses = entries.map((entry) =>
        this.typeOnly.has(`${module} ${entry[0]}`) ? `type ${clause(entry)}` : clause(entry),
      );
      out.push(`import { ${clauses.join(', ')} } from '${module}';`);
    }
    if (this.imports.size > 0 || this.sideEffects.size > 0) out.push('');
    if (this.hoisted.length > 0) out.push(...this.hoisted, '');
    // Everything above the body, so a body line's index can be turned into a file line. Counted
    // in newlines, not in entries: the banner and a hoisted declaration are each several lines.
    const bannerLines = this.banner.split('\n').length - 1;
    const headLines = out.join('\n').split('\n').length;
    this.lineOrigins = new Map<number, Origin>();
    for (const [index, origin] of imported) this.lineOrigins.set(index + bannerLines, origin);
    let next = 0;
    let current: Origin | undefined;
    for (let i = 0; i < this.lines.length; i++) {
      while (next < this.origins.length && this.origins[next]!.from <= i) current = this.origins[next++]!.origin;
      if (current) this.lineOrigins.set(headLines + i + 1, current);
    }
    out.push(...this.lines);
    // One trailing newline, never two — the file is regenerated constantly and a stable byte
    // sequence is what keeps a watch loop from rewriting an unchanged file.
    return `${out.join('\n').replace(/\n+$/, '')}\n`;
  }
}

/** Packages first, then relative paths — the order a person would write them in. */
function sortImports(a: string, b: string): number {
  const relative = (s: string) => (s.startsWith('.') ? 1 : 0);
  return relative(a) - relative(b) || a.localeCompare(b);
}

const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import',
  'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try',
  'typeof', 'var', 'void', 'while', 'with', 'let', 'static', 'yield', 'await', 'implements',
  'interface', 'package', 'private', 'protected', 'public',
]);

/** A legal, non-reserved TypeScript identifier derived from an authored name. */
export function sanitizeIdentifier(text: string): string {
  const cleaned = text.replace(/[^A-Za-z0-9_$]/g, '_').replace(/^[0-9]/, (d) => `_${d}`);
  const name = cleaned || '_';
  return RESERVED.has(name) ? `${name}_` : name;
}

/** `brick-wall` → `BrickWall`; the class name a document's file name produces. */
export function pascalCase(text: string): string {
  const parts = text.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const joined = parts.map((p) => p[0]!.toUpperCase() + p.slice(1)).join('');
  return sanitizeIdentifier(joined || 'Asset');
}

/** `brick-wall` → `brickWall`; the const name a geometry or material document produces. */
export function camelCase(text: string): string {
  const pascal = pascalCase(text);
  return sanitizeIdentifier(pascal[0]!.toLowerCase() + pascal.slice(1));
}
