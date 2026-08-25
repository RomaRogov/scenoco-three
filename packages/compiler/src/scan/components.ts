import type { Checker, Project, Symbol as TsSymbol } from 'typescript/unstable/sync';
import * as ast from 'typescript/unstable/ast';
import type { ComponentInfo, SerializedField } from '../model.js';
import {
  baseChainOf,
  baseClauseType,
  baseTypeArgument,
  classDeclarationOf,
  decoratorName,
  isAbstractClass,
  derivesFrom,
  docOf,
  lineOf,
  resolveAlias,
  textOf,
} from './ast-utils.js';
import { shapeOf } from './shape.js';
import type { Workspace } from './workspace.js';

/**
 * Find every component in a workspace and describe it.
 *
 * This **replaces the runtime registry**. v1 registered components by executing a decorator as
 * an import side effect, which meant the build had to load every component module to know what
 * existed — and a circular import between two components silently registered a broken entry.
 * Reading the source executes nothing, so that entire class of failure is gone, along with the
 * duplicate-tag errors a process-global registry produced.
 *
 * A class qualifies by extending `Component`, transitively. Nothing else marks it: no
 * decorator, no tag name, no registration call.
 */
export function scanComponents(
  workspace: Workspace,
  modules: readonly string[] = [],
): ComponentInfo[] {
  return scanClasses(workspace, 'Component', modules);
}

/**
 * Find every system in a workspace.
 *
 * The same scan with a different base class, because a system is declared the same way a
 * component is: extend the class, make the settings public fields, and that is the whole
 * registration. Nothing else about the two needs to differ, and nothing here makes it.
 */
export function scanSystems(
  workspace: Workspace,
  modules: readonly string[] = [],
): ComponentInfo[] {
  return scanClasses(workspace, 'System', modules);
}

/**
 * Find every effect in a workspace — the same scan again, with `Effect` as the base.
 *
 * Three scans, three base classes, one piece of code: a component, a system and an effect are
 * authored identically (extend the class, make the settings public fields), and the only thing
 * that differs is where a document may write one.
 */
export function scanEffects(
  workspace: Workspace,
  modules: readonly string[] = [],
): ComponentInfo[] {
  return scanClasses(workspace, 'Effect', modules);
}

function scanClasses(
  workspace: Workspace,
  baseName: string,
  modules: readonly string[],
): ComponentInfo[] {
  const { checker, project } = workspace;
  const found: ComponentInfo[] = [];
  const claimed = new Map<string, ComponentInfo>();

  /**
   * Record one class under its name, or reject a genuine name clash.
   *
   * Keyed on the *declaration* — file and line — rather than on where it was reached from. In a
   * workspace a package's source is also project source, so the same class arrives twice: once
   * from the file walk and once from the package's exports. That is one class, not a conflict.
   * Two different classes answering to one tag is the real mistake, and it stays an error.
   */
  const claim = (info: ComponentInfo): void => {
    const existing = claimed.get(info.name);
    if (existing) {
      if (identityOf(existing) === identityOf(info)) {
        // The same class, reached twice. In a workspace a package's source is also project
        // source, so it arrives from the file walk and again from the package's exports; the
        // package identity is the better of the two, because that is what a document imports.
        if (info.module && !existing.module) existing.module = info.module;
        return;
      }
      throw new Error(
        `[scenoco] <${info.name}> is declared twice: ${existing.file}:${existing.line} and ` +
          `${info.file}:${info.line}. Two classes cannot both answer to one tag — rename one, ` +
          'or drop a dependency. (A physics back-end and its drop-in alternative deliberately ' +
          'share names, so a project picks one.)',
      );
    }
    claimed.set(info.name, info);
    found.push(info);
  };

  for (const { fileName, sourceFile } of workspace.ownSourceFiles()) {
    // Generated code declares no components. It is *output* — a scene class, a prefab class —
    // and reading it back in means a build's own product becomes an input to the next build,
    // which is how a document and a component came to collide on the second compile and not
    // the first. The suffixed class names make that collision impossible now; this makes the
    // loop impossible, which is the more durable half.
    if (fileName.endsWith('.gen.ts')) continue;
    for (const statement of sourceFile.statements) {
      if (!ast.isClassDeclaration(statement) || !statement.name) continue;
      // An abstract subclass is a base other classes share — `Collider2D` — not a tag a
      // document can write. The same rule as for a package's exports; one rule, both routes.
      if (isAbstractClass(statement)) continue;
      if (!derivesFrom(statement, baseName, checker, project)) continue;
      claim(describe(statement, sourceFile, checker, project, fileName, baseName));
    }
  }

  // A component or system a *package* provides — `RigidBody2D` from `@scenoco-three/box2d`.
  // Reached through the module's exports rather than by walking files, which is the same door
  // `scanTags` uses for `three`, and described by exactly the same code as a project's own
  // class so the two are indistinguishable downstream.
  for (const specifier of modules) {
    for (const info of scanModule(workspace, specifier, baseName)) claim(info);
  }
  return found;
}

/** Every class exported by `specifier` that derives from `baseName`. */
function scanModule(workspace: Workspace, specifier: string, baseName: string): ComponentInfo[] {
  const { checker, project } = workspace;
  const moduleSymbol = workspace.resolveModule(specifier);
  if (!moduleSymbol) return [];

  const found: ComponentInfo[] = [];
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    if (!/^[A-Z]/.test(exported.name)) continue;
    const declared = resolveAlias(exported, checker);
    const declaration = classDeclarationOf(declared, project);
    if (!declaration || !declaration.name) continue;
    // Abstract bases — `Collider2D` — are shared machinery, not tags a document can write.
    if (isAbstractClass(declaration)) continue;
    // Checked through the type first, which sees through however many intermediate classes a
    // package puts between its shapes and `Component`.
    const type = checker.getDeclaredTypeOfSymbol(declared);
    const chain = type ? baseChainOf(type, checker) : [];
    if (!chain.includes(baseName) && !derivesFrom(declaration, baseName, checker, project)) continue;

    const sourceFile = sourceFileOfDeclaration(declared, project);
    if (!sourceFile) continue;
    found.push({
      ...describe(declaration, sourceFile, checker, project, handlePath(declared, project), baseName),
      module: specifier,
    });
  }
  return found;
}

/**
 * What makes two descriptions the same class: file and line.
 *
 * Case-folded, because the two routes to a class report its path differently — the file walk
 * keeps the on-disk casing, while a resolved declaration handle gives the compiler's canonical
 * form, which is lowercased on a case-insensitive filesystem. Comparing them raw would call one
 * class two, and turn a workspace package into a duplicate-tag error.
 */
function identityOf(info: ComponentInfo): string {
  return `${info.file.toLowerCase()}:${info.line}`;
}

/** The path of the file a symbol's class declaration lives in. */
function handlePath(symbol: TsSymbol, project: Project): string {
  for (const handle of symbol.declarations) {
    const node = handle.resolve(project);
    if (node && ast.isClassDeclaration(node)) return String(handle.path);
  }
  return '(unknown)';
}

/**
 * The source file a symbol's class declaration lives in.
 *
 * `describe` reads the declaration's *text* — the initializer, the doc comment — and those are
 * offsets into the file that declares it, not into whatever file imported it. A handle carries
 * its own path, which is how the right file is fetched.
 */
function sourceFileOfDeclaration(symbol: TsSymbol, project: Project): ast.SourceFile | undefined {
  for (const handle of symbol.declarations) {
    const node = handle.resolve(project);
    if (node && ast.isClassDeclaration(node)) return project.program.getSourceFile(handle.path);
  }
  return undefined;
}


function describe(
  node: ast.ClassDeclaration,
  sourceFile: ast.SourceFile,
  checker: Checker,
  project: Project,
  fileName: string,
  baseName: string,
): ComponentInfo {
  const base = baseClauseType(node);
  const declaredBase = base && ast.isIdentifier(base) ? base.text : undefined;
  const fields = collectFields(node, sourceFile, checker, project, baseName);
  return {
    name: node.name!.text,
    file: fileName,
    line: lineOf(sourceFile, node),
    ...(docOf(sourceFile, node) ? { description: docOf(sourceFile, node) } : {}),
    ...(declaredBase && declaredBase !== baseName ? { extends: declaredBase } : {}),
    // `Component<PointLight>` — the node type this component insists on. The compiler checks a
    // scene against it, so a mis-hosted component is a diagnostic at the XML line rather than
    // a type error inside generated code.
    ...(baseName === 'Component' && nodeConstraint(node, sourceFile)
      ? { requiresNode: nodeConstraint(node, sourceFile)! }
      : {}),
    fields,
  };
}

/**
 * Every serialized field of a class, **inherited ones included**, base-first.
 *
 * A shape package puts its shared material properties on an abstract base — `Collider2D` holds
 * `density`, `friction`, `restitution`, `isSensor` — and a document writes them on the concrete
 * tag. Reading only a class's own members would drop all of them, so the walk climbs the
 * `extends` chain until it reaches the engine's own base, which has nothing a document authors.
 *
 * Base first, so a subclass that redeclares a field wins.
 */
function collectFields(
  node: ast.ClassDeclaration,
  sourceFile: ast.SourceFile,
  checker: Checker,
  project: Project,
  stopAt: string,
): SerializedField[] {
  const fields: SerializedField[] = [];
  const seen = new Set<string>();

  const visit = (current: ast.ClassDeclaration, file: ast.SourceFile, depth: number): void => {
    if (depth > 8) return;
    const base = baseClauseType(current);
    const located = base ? checker.getSymbolAtLocation(base) : undefined;
    const symbol = located ? resolveAlias(located, checker) : undefined;
    // Stop at `Component` / `System`: the engine's own members are lifecycle and bookkeeping,
    // never something a document writes.
    if (symbol && symbol.name !== stopAt) {
      const declaration = classDeclarationOf(symbol, project);
      const declarationFile = declaration ? sourceFileOfDeclaration(symbol, project) : undefined;
      if (declaration && declarationFile) visit(declaration, declarationFile, depth + 1);
    }
    for (const member of current.members) {
      const field = describeField(member, file, checker);
      if (!field) continue;
      if (seen.has(field.name)) {
        // Redeclared lower down: the subclass's version replaces the base's, in place, so the
        // declaration order a reader sees is still base-first.
        fields[fields.findIndex((f) => f.name === field.name)] = field;
        continue;
      }
      seen.add(field.name);
      fields.push(field);
    }
  };

  visit(node, sourceFile, 0);
  return fields;
}

/** `PointLight` from `class Flicker extends Component<PointLight>`, if it declared one. */
function nodeConstraint(node: ast.ClassDeclaration, sourceFile: ast.SourceFile): string | undefined {
  const written = baseTypeArgument(node, sourceFile);
  return written && written !== 'Object3D' ? written : undefined;
}

/**
 * Describe one class member as a serialized field, or skip it.
 *
 * **Public fields are serialized; private ones are not** — exactly as `public` and
 * `[SerializeField]` work in Unity. `@serialize` exists only to opt a private field in, or to
 * add a fact the type genuinely cannot carry.
 */
function describeField(
  member: ast.ClassElement,
  sourceFile: ast.SourceFile,
  checker: Checker,
): SerializedField | undefined {
  if (!ast.isPropertyDeclaration(member) || ast.isComputedPropertyName(member.name)) return undefined;

  const modifiers = member.modifiers ?? [];
  const decorators = modifiers.filter((m) => ast.isDecorator(m)) as ast.Decorator[];
  const serializeDecorator = decorators.find((d) => decoratorName(d) === 'serialize');
  const isPrivate = modifiers.some(
    (m) => m.kind === ast.SyntaxKind.PrivateKeyword || m.kind === ast.SyntaxKind.ProtectedKeyword,
  );
  const isStatic = modifiers.some((m) => m.kind === ast.SyntaxKind.StaticKeyword);
  // `#field` is private in a way no decorator can reach — skip it outright.
  if (isStatic || ast.isPrivateIdentifier(member.name)) return undefined;
  if (isPrivate && !serializeDecorator) return undefined;
  // A `readonly` field is state the component owns, not a knob — `readonly destroyed = new
  // Event<…>()` is the common case, and assigning to it in generated code would not compile.
  if (modifiers.some((m) => m.kind === ast.SyntaxKind.ReadonlyKeyword)) return undefined;

  const type = checker.getTypeAtLocation(member);
  const { shape, elementShape, options } = shapeOf(type, checker);

  return {
    name: (member.name as ast.Identifier).text,
    // The written annotation wins because `typeToString` expands every type argument: a field
    // declared `bricks: Mesh[]` prints as `Mesh<BufferGeometry<NormalBufferAttributes, …>, …>[]`,
    // which is accurate and useless in an inspector. The checker still answers for an inferred
    // field (`origin = new Vector3(0, 1, 0)` → `Vector3`), where there is no annotation to read.
    type: textOf(sourceFile, member.type) ?? (type ? checker.typeToString(type) : 'unknown'),
    shape,
    ...(elementShape ? { elementShape } : {}),
    ...(options ? { options } : {}),
    ...(member.initializer ? { default: textOf(sourceFile, member.initializer) } : {}),
    ...(docOf(sourceFile, member) ? { description: docOf(sourceFile, member) } : {}),
    // Required means "nothing but the document can supply this", so it only applies to a field
    // the document *can* write. `paddle!: Mesh` is required — the `!` says "assigned
    // elsewhere", and for a node reference that elsewhere is the authored value. `world!:
    // World` is not: its type is nothing an attribute can express, so the `!` means what it
    // usually means, that `awake` builds it.
    //
    // **Never from a declaration file.** A published package resolves to its `.d.ts`, and
    // TypeScript emits both `linearDamping = 0` and `linearDamping!: number` as
    // `linearDamping: number` — the initializer is erased, so "has a default" and "must be
    // supplied" become the same text. Guessing "required" there made every field of every tag
    // package mandatory the moment it was consumed as a package rather than as source, which is
    // to say in every real project. Guessing the other way costs a `missing-attribute` the
    // runtime still reports; guessing this way made the packages unusable.
    required:
      shape !== 'unsupported' &&
      !sourceFile.isDeclarationFile &&
      member.initializer === undefined &&
      member.postfixToken?.kind !== ast.SyntaxKind.QuestionToken,
    explicit: serializeDecorator !== undefined,
    ...(serializeDecorator && ast.isCallExpression(serializeDecorator.expression)
      ? { serializeOptions: textOf(sourceFile, serializeDecorator.expression.arguments[0]) }
      : {}),
  };
}
