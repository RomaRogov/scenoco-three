import type { Checker, Project, Symbol as TsSymbol, Type } from 'typescript/unstable/sync';
import * as ast from 'typescript/unstable/ast';

/** The source text of a node, trimmed. */
export function textOf(sourceFile: ast.SourceFile, node: ast.Node | undefined): string | undefined {
  return node ? sourceFile.text.slice(node.pos, node.end).trim() : undefined;
}

/** 1-based line number of a node. */
export function lineOf(sourceFile: ast.SourceFile, node: ast.Node): number {
  let line = 1;
  for (let i = 0; i < node.pos && i < sourceFile.text.length; i++) {
    if (sourceFile.text.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * The doc comment above a node, as one line.
 *
 * Read from the leading comment range rather than a symbol lookup: the summary has to come
 * from the same text the IDE shows on hover, which is the point of putting descriptions in
 * JSDoc instead of a decorator argument.
 */
export function docOf(sourceFile: ast.SourceFile, node: ast.Node): string | undefined {
  const comments: string[] = [];
  ast.forEachLeadingCommentRange(sourceFile.text, node.pos, (pos, end) => {
    comments.push(sourceFile.text.slice(pos, end));
  });
  const block = comments.find((c) => c.startsWith('/**'));
  if (!block) return undefined;
  const lines = block
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*/, '').trim());

  // The **first paragraph only**. A good doc comment on a component runs to twenty lines with a
  // worked XML example in it; all of that belongs in the source, and none of it belongs in an
  // inspector row's tooltip. The blank line the author already wrote is where it ends.
  const summary: string[] = [];
  for (const line of lines) {
    if (line.startsWith('@')) break;
    if (line.length === 0) {
      if (summary.length > 0) break;
      continue;
    }
    // A fenced example is not prose, and an author who opens one has finished the summary.
    if (line.startsWith('```')) break;
    summary.push(line);
  }
  const text = summary.join(' ').trim();
  return text.length > 0 ? text : undefined;
}

/** The identifier of a decorator, whether it is `@x` or `@x(...)`. */
export function decoratorName(decorator: ast.Decorator): string | undefined {
  const expression = ast.isCallExpression(decorator.expression)
    ? decorator.expression.expression
    : decorator.expression;
  return ast.isIdentifier(expression) ? expression.text : undefined;
}

/** The expression in a class's `extends` clause, if it has one. */
export function baseClauseType(node: ast.ClassDeclaration): ast.Expression | undefined {
  for (const clause of node.heritageClauses ?? []) {
    if (clause.token === ast.SyntaxKind.ExtendsKeyword) return clause.types[0]?.expression;
  }
  return undefined;
}

/** The first type argument written in a class's `extends` clause — `Component<PointLight>`. */
export function baseTypeArgument(node: ast.ClassDeclaration, sourceFile: ast.SourceFile): string | undefined {
  for (const clause of node.heritageClauses ?? []) {
    if (clause.token !== ast.SyntaxKind.ExtendsKeyword) continue;
    const argument = clause.types[0]?.typeArguments?.[0];
    if (argument) return textOf(sourceFile, argument);
  }
  return undefined;
}

/**
 * Resolve a symbol's first class declaration back to a real AST node.
 *
 * `symbol.declarations` are **handles**, not nodes: in TypeScript 7 the AST lives in the Go
 * compiler and is fetched on demand, so every one has to be resolved through the project.
 */
export function classDeclarationOf(symbol: TsSymbol, project: Project): ast.ClassDeclaration | undefined {
  for (const handle of symbol.declarations) {
    const resolved = handle.resolve(project);
    if (resolved && ast.isClassDeclaration(resolved)) return resolved;
  }
  return undefined;
}

/**
 * Follow an import or re-export alias to the symbol that actually declares the thing.
 *
 * `import { Collider2D } from './Collider2D.js'` gives an *alias* symbol whose declaration is
 * the import clause, not the class. Every walk that crosses a module boundary has to step
 * through it — which is most of them, once components come from packages rather than from one
 * file.
 */
export function resolveAlias(symbol: TsSymbol, checker: Checker): TsSymbol {
  let current = symbol;
  for (let depth = 0; depth < 8; depth++) {
    let next: TsSymbol | undefined;
    try {
      next = checker.getAliasedSymbol(current);
    } catch {
      return current;
    }
    if (!next || next === current) return current;
    current = next;
  }
  return current;
}

/** Whether a class is declared `abstract` — machinery rather than something to construct. */
export function isAbstractClass(node: ast.ClassDeclaration): boolean {
  return (node.modifiers ?? []).some((m) => m.kind === ast.SyntaxKind.AbstractKeyword);
}

/**
 * Whether a class derives from a class named `baseName`, at any depth.
 *
 * Resolved through the **type checker**, not by matching the name in the `extends` clause, so
 * `class Enemy extends Character` is found when `Character` extends `Component` — and a local
 * class that merely happens to be called `Component` is not.
 */
export function derivesFrom(
  node: ast.ClassDeclaration,
  baseName: string,
  checker: Checker,
  project: Project,
): boolean {
  let current: ast.ClassDeclaration | undefined = node;
  const seen = new Set<string>();
  while (current) {
    const base = baseClauseType(current);
    if (!base) return false;
    const located = checker.getSymbolAtLocation(base);
    if (!located) return false;
    // The base may be an import: `class BoxCollider2D extends Collider2D` where `Collider2D`
    // came from another module. Without this step the walk stops at the import clause and a
    // component two modules deep is never found.
    const symbol = resolveAlias(located, checker);
    if (symbol.name === baseName) return true;
    // Guard against a cycle in malformed sources — the walk is over declarations the checker
    // resolved, so it should terminate, but a loop here would hang the build rather than
    // report anything.
    if (seen.has(symbol.name)) return false;
    seen.add(symbol.name);
    current = classDeclarationOf(symbol, project);
  }
  return false;
}

/**
 * Every class this type derives from, nearest first, by name.
 *
 * Walks `getBaseTypes` rather than the `extends` clause, so it sees through type aliases and
 * through the interface merges three.js uses (`MeshStandardMaterial` derives from both
 * `Material` and `MeshStandardMaterialProperties`).
 */
export function baseChainOf(type: Type, checker: Checker, limit = 16): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  let frontier: Type[] = [type];
  for (let depth = 0; depth < limit && frontier.length > 0; depth++) {
    const next: Type[] = [];
    for (const current of frontier) {
      for (const base of basesOf(current, checker)) {
        const name = base.getSymbol()?.name;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        names.push(name);
        next.push(base);
      }
    }
    frontier = next;
  }
  return names;
}

/**
 * The direct bases of a type, seeing through a generic instantiation.
 *
 * `getBaseTypes` answers for a class or interface *declaration*; a field annotated `Mesh` is a
 * reference to `Mesh<TGeometry, TMaterial, TEventMap>` and has none of its own. Asking the
 * reference's target is what makes `bricks: Mesh[]` recognisable as a list of nodes, and
 * three.js parameterises almost everything, so this is the common path rather than the corner.
 */
function basesOf(type: Type, checker: Checker): readonly Type[] {
  const direct = checker.getBaseTypes(type as never);
  if (direct && direct.length > 0) return direct;
  if (!type.isTypeReference()) return [];
  const target = type.getTarget();
  if (!target || target === type) return [];
  return checker.getBaseTypes(target as never) ?? [];
}
