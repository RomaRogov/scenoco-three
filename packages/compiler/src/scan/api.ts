/**
 * `describe` for the runtime API, read off the declarations rather than written by hand.
 *
 * Why this exists: an agent asked `describe Component`, got the primer, and then went into
 * `node_modules` to read `Component.d.ts`, `types.d.ts` and `SceneManager.js` anyway — eight
 * minutes of a thirty-seven-minute build, before a line was written. The primer said what a
 * thing *is*; it could not say what it *has*. This answers that half from the same declarations
 * `tsc` checks, so it cannot drift, and so nothing about the framework has to be found in a file.
 *
 * Two shapes of answer:
 *
 * - an export of `@scenoco-three/core` or a tag package — a class (`Component`, `System`), or an
 *   instance (`Input`, `Time`, `SceneManager`): its members, with the first sentence of each doc.
 * - `Object3D` or `Scene`: *what the framework adds* to the three.js class. The augmentation is
 *   the whole node API — `addComponent`, `instantiate`, `destroy`, `byId` — and three's own hundred
 *   members are documented elsewhere, so those are left out.
 */
import { SignatureKind, type Checker, type Symbol as TsSymbol, type Type } from 'typescript/unstable/sync';
import * as ast from 'typescript/unstable/ast';
import { docOf, docOfSymbol, resolveAlias, textOf } from './ast-utils.js';
import type { Workspace } from './workspace.js';

const CORE = '@scenoco-three/core';

/** A member line: the signature as declared, and its doc's first sentence, if any. */
interface Member {
  text: string;
  doc?: string;
}

export function describeApi(workspace: Workspace, name: string, modules: readonly string[]): string | undefined {
  const { checker } = workspace;

  // The augmented three.js classes: only what the framework added.
  if (name === 'Object3D' || name === 'Scene') {
    const three = workspace.resolveModule('three');
    const symbol = three && checker.getExportsOfModule(three).find((s) => s.name === name);
    const instance = symbol && instanceTypeOf(symbol, checker);
    if (!instance) return undefined;
    const members = membersOf(instance, workspace, (path) => !isThree(path));
    if (members.length === 0) return undefined;
    const what =
      name === 'Object3D'
        ? 'what @scenoco-three/core adds to every three.js node. `this.object3D` in a component is one'
        : 'what @scenoco-three/core adds to THREE.Scene. `this.scene` in a component is one';
    return [`${name} — ${what}:`, ...render(members)].join('\n');
  }

  for (const specifier of [CORE, ...modules.filter((m) => m !== 'three' && m !== CORE)]) {
    const moduleSymbol = workspace.resolveModule(specifier);
    if (!moduleSymbol) continue;
    const exported = checker.getExportsOfModule(moduleSymbol).find((s) => s.name === name);
    if (!exported) continue;
    const declared = resolveAlias(exported, checker);
    const instance = instanceTypeOf(declared, checker) ?? checker.getTypeOfSymbol(declared);
    if (!instance) continue;
    const members = membersOf(instance, workspace, () => true);
    const summary = firstSentence(docOfSymbol(declared, workspace.project) ?? '');
    const heading = `${name} — from ${specifier}${summary ? `. ${summary}` : ''}`;
    return members.length ? [heading, ...render(members)].join('\n') : heading;
  }
  return undefined;
}

/** For a class symbol, the type of an instance; for anything else, undefined. */
function instanceTypeOf(symbol: TsSymbol, checker: Checker): Type | undefined {
  const staticType = checker.getTypeOfSymbol(symbol);
  if (!staticType) return undefined;
  const signature = checker.getSignaturesOfType(staticType, SignatureKind.Construct)[0];
  return signature ? checker.getReturnTypeOfSignature(signature) : undefined;
}

function membersOf(type: Type, workspace: Workspace, keep: (path: string) => boolean): Member[] {
  const { checker, project } = workspace;
  const members: Member[] = [];
  for (const symbol of checker.getPropertiesOfType(type)) {
    if (symbol.name.startsWith('_') || symbol.name.startsWith('#')) continue;
    const lines: string[] = [];
    let doc: string | undefined;
    for (const handle of symbol.declarations) {
      const path = String(handle.path);
      if (!keep(path)) continue;
      const node = handle.resolve(project);
      const sourceFile = node && project.program.getSourceFile(handle.path);
      if (!node || !sourceFile) continue;
      if (isHidden(node, sourceFile)) continue;
      const text = signatureOf(node, sourceFile);
      if (!text) continue;
      lines.push(text);
      doc ??= docOf(sourceFile, node);
    }
    if (lines.length === 0) continue;
    // Overloads are one entry: the reader wants the verb once, with every way to call it.
    members.push({ text: lines.join('\n  '), ...(doc ? { doc } : {}) });
  }
  return members;
}

/** Non-public, `@internal`, or the engine's own bookkeeping: not part of the answer. */
function isHidden(node: ast.Node, sourceFile: ast.SourceFile): boolean {
  const modifiers = (node as { modifiers?: readonly ast.Node[] }).modifiers ?? [];
  for (const modifier of modifiers) {
    if (
      modifier.kind === ast.SyntaxKind.PrivateKeyword ||
      modifier.kind === ast.SyntaxKind.ProtectedKeyword ||
      modifier.kind === ast.SyntaxKind.StaticKeyword
    ) {
      return true;
    }
  }
  let internal = false;
  ast.forEachLeadingCommentRange(sourceFile.text, node.pos, (pos, end) => {
    if (sourceFile.text.slice(pos, end).includes('@internal')) internal = true;
  });
  return internal;
}

/**
 * The declaration on one line, as written: the annotation the author chose, not the checker's
 * expansion of it. A method's body and a doc comment are dropped; a field keeps its initializer,
 * which is its default.
 */
function signatureOf(node: ast.Node, sourceFile: ast.SourceFile): string | undefined {
  const body = (node as { body?: ast.Node }).body;
  const end = body ? body.pos : node.end;
  let text = sourceFile.text.slice(node.pos, end);
  // Leading trivia — the doc comment — is inside `pos`, so strip every comment at the front.
  text = text.replace(/^(\s*\/\*[\s\S]*?\*\/|\s*\/\/[^\n]*)*\s*/, '');
  text = text.replace(/^(?:export |override |public |readonly |declare )+/, '');
  text = text.replace(/\s+/g, ' ').replace(/\s*;\s*$/, '').trim();
  if (text.length === 0 || text.length > 240) return undefined;
  return text;
}

function render(members: Member[]): string[] {
  return members.map((member) =>
    member.doc ? `  ${member.text}\n      ${firstSentence(member.doc)}` : `  ${member.text}`,
  );
}

function firstSentence(text: string): string {
  const cut = text.search(/\.\s|\.$/);
  const sentence = cut === -1 ? text : text.slice(0, cut + 1);
  return sentence.length > 160 ? `${sentence.slice(0, 157)}…` : sentence;
}

function isThree(path: string): boolean {
  return /\/node_modules\/(?:@types\/)?three\//.test(path);
}
