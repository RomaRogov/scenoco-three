import { readdirSync, realpathSync } from 'node:fs';
import { API, type Checker, type Project, type Symbol as TsSymbol } from 'typescript/unstable/sync';
import * as ast from 'typescript/unstable/ast';

/**
 * One open TypeScript project, shared by every scan.
 *
 * Opening a project is the expensive part (the Go compiler loads and binds the whole
 * program), so the component scan and the tag scan share one — a build that opened two would
 * pay for `three`'s declarations twice.
 *
 * Callers **must** `close()` it; the API holds a child process.
 */
export class Workspace {
  readonly project: Project;
  readonly checker: Checker;

  private readonly api: API;

  private constructor(api: API, project: Project) {
    this.api = api;
    this.project = project;
    this.checker = project.checker;
  }

  /**
   * Open the project described by `tsconfigPath`.
   *
   * `overlay` maps absolute paths to contents the program should read *instead of* the disk —
   * how `scenoco check` typechecks the modules it just compiled without writing one of them. The
   * compiler's own server reads through these callbacks, so a file that exists only here is a
   * real member of the program: it resolves imports, and errors in it have positions.
   */
  static open(tsconfigPath: string, cwd?: string, overlay?: ReadonlyMap<string, string>): Workspace {
    const api = new API({
      cwd: cwd ?? dirOf(tsconfigPath),
      ...(overlay && overlay.size > 0 ? { fs: virtualFiles(overlay) } : {}),
    });
    try {
      const project = api.updateSnapshot({ openProjects: [tsconfigPath] }).getProject(tsconfigPath);
      if (!project) throw new Error(`No TypeScript project at ${tsconfigPath}`);
      return new Workspace(api, project);
    } catch (error) {
      api.close();
      throw error;
    }
  }

  /** Run `body` against an open workspace and close it afterwards, throw or not. */
  static with<T>(
    tsconfigPath: string,
    body: (workspace: Workspace) => T,
    cwd?: string,
    overlay?: ReadonlyMap<string, string>,
  ): T {
    const workspace = Workspace.open(tsconfigPath, cwd, overlay);
    try {
      return body(workspace);
    } finally {
      workspace.close();
    }
  }

  close(): void {
    this.api.close();
  }

  /** Every source file in the program that belongs to the project rather than a dependency. */
  *ownSourceFiles(): Generator<{ fileName: string; sourceFile: ast.SourceFile }> {
    for (const fileName of this.project.program.getSourceFileNames()) {
      // Nothing in node_modules declares a game component, and walking it would dominate the
      // scan — the tag scan reaches `three` deliberately, through its module symbol.
      if (fileName.includes('/node_modules/')) continue;
      const sourceFile = this.project.program.getSourceFile(fileName);
      if (sourceFile) yield { fileName, sourceFile };
    }
  }

  /**
   * The module symbol for `specifier`, resolved the way an import in `fromFile` would resolve
   * it. Used to read `three`'s exports without hard-coding a path to its declarations.
   */
  moduleSymbolOf(specifier: string, fromFile: ast.SourceFile): TsSymbol | undefined {
    for (const statement of fromFile.statements) {
      if (!ast.isImportDeclaration(statement)) continue;
      const text = literalText(statement.moduleSpecifier, fromFile);
      if (text === specifier) return this.checker.getSymbolAtLocation(statement.moduleSpecifier);
    }
    return undefined;
  }

  /**
   * The module symbol for `specifier`, found through whichever of the project's own files
   * imports it.
   *
   * A module symbol has to be reached from a real import in a real file — there is no
   * "resolve this specifier" entry point — so a package's classes are only visible when the
   * project actually depends on it, which is the right answer anyway.
   */
  resolveModule(specifier: string): TsSymbol | undefined {
    for (const { sourceFile } of this.ownSourceFiles()) {
      const symbol = this.moduleSymbolOf(specifier, sourceFile);
      if (symbol) return symbol;
    }
    return undefined;
  }
}

/**
 * Files the program reads from memory rather than from disk.
 *
 * `readFile` and `fileExists` are not enough on their own: a tsconfig says `include: ["assets"]`,
 * and the program finds what is in there by *listing* the directory — so a file that exists only
 * in the overlay has to appear in that listing too, or it is never part of the program and its
 * errors are never found. Returning `undefined` anywhere here means "ask the disk".
 */
function virtualFiles(overlay: ReadonlyMap<string, string>): {
  readFile(file: string): string | undefined;
  fileExists(file: string): boolean | undefined;
  getAccessibleEntries(directory: string): { files: string[]; directories: string[] } | undefined;
} {
  const slashed = new Map<string, string>();
  const added = new Map<string, Set<string>>();
  for (const [path, text] of overlay) {
    const normal = path.split('\\').join('/');
    const cut = normal.lastIndexOf('/');
    const name = normal.slice(cut + 1);
    // Under both spellings of the directory. The program canonicalises what it reads, and on
    // macOS a temporary directory is `/var/folders/…` to the caller and `/private/var/folders/…`
    // once resolved — so an overlay keyed only the way the caller spelled it is never found.
    for (const directory of new Set([normal.slice(0, cut), realDirectory(normal.slice(0, cut))])) {
      slashed.set(`${directory}/${name}`, text);
      const entries = added.get(directory) ?? new Set<string>();
      entries.add(name);
      added.set(directory, entries);
    }
  }
  return {
    readFile: (file) => slashed.get(file.split('\\').join('/')),
    fileExists: (file) => (slashed.has(file.split('\\').join('/')) ? true : undefined),
    getAccessibleEntries: (directory) => {
      const extra = added.get(directory.replace(/\/$/, '').split('\\').join('/'));
      if (!extra) return undefined;
      const files = new Set(extra);
      const directories: string[] = [];
      try {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          if (entry.isDirectory()) directories.push(entry.name);
          else files.add(entry.name);
        }
      } catch {
        // A directory that exists only because a generated file lands in it.
      }
      return { files: [...files], directories };
    },
  };
}

/** `directory` as the filesystem itself spells it, or unchanged when it does not exist yet. */
function realDirectory(directory: string): string {
  try {
    return realpathSync(directory).split('\\').join('/');
  } catch {
    return directory;
  }
}

/** The text of a string literal, with its quotes stripped. */
function literalText(node: ast.Node, sourceFile: ast.SourceFile): string {
  return sourceFile.text.slice(node.pos, node.end).trim().replace(/^['"`]|['"`]$/g, '');
}

function dirOf(file: string): string {
  const i = file.lastIndexOf('/');
  return i === -1 ? '.' : file.slice(0, i);
}
