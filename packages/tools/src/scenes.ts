/**
 * Every `.tsx` file is a scene, and a scene only declares.
 *
 * A scene file may import, define constants — plain data, or objects made from it with `new`
 * (`const font = new Font(json)`) — and export functions that make refs and return TSX, plain or made
 * prefabs with `prefab(() => …)`. Inside the
 * TSX a value is a literal, a list or object of them, arithmetic on them (`-Math.PI / 2`), flags
 * combined with `|` (`RigidbodyConstraints.FreezeRotationX | RigidbodyConstraints.FreezeRotationZ`), or a name. Anything that runs — a loop, a branch, a handler, a call, a hook — is
 * a component's job, in a `.ts` file. Each refusal says where and what to write instead.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseSync } from 'rolldown/utils';

// The parser's tree, as plain objects: every node has a `type`, `start` and `end`.
type Node = { type: string; start: number; end: number; [key: string]: unknown };

const LOOP = 'a scene has no loops — to place many, spawn them from a component with instantiate(Prefab)';
const BRANCH = 'a scene has no branches — show or hide from a component (node.visible, or destroy)';
const HANDLER = 'a scene has no handlers — what happens goes in a component: a class in a .ts file, with update()';
const HOOK = 'there is no React here — TSX builds three.js objects once; what runs each frame is a component\'s update()';
const CALL = 'a scene calls nothing — a value is a literal, a list or object of them, arithmetic like -Math.PI / 2, or a name';
const NEW = 'a tag makes an object here — or make it in a constant above the scene, from data: const font = new Font(json)';

export function checkScene(file: string, code: string): string[] {
  const problems: string[] = [];
  const at = (node: Node, message: string) => {
    const before = code.slice(0, node.start).split('\n');
    problems.push(`${file}:${before.length}:${before.at(-1)!.length + 1}  ${message}`);
  };
  const { program, errors } = parseSync(file, code, { lang: 'tsx' }) as unknown as { program: Node; errors: { message: string }[] };
  if (errors.length) return [`${file}  ${errors[0]!.message}`];

  /** True while reading a module constant, which may also make an object from data with `new`. */
  let constant = false;

  /** A value that is data: literals, lists and objects of them, arithmetic on them, names and their members. */
  const value = (node: Node | null | undefined): void => {
    if (!node) return;
    switch (node.type) {
      case 'Literal':
      case 'Identifier':
      case 'JSXEmptyExpression':
        return;
      case 'TemplateLiteral':
        if ((node.expressions as Node[]).length) at(node, CALL);
        return;
      case 'ParenthesizedExpression':
      case 'TSAsExpression':
      case 'TSNonNullExpression':
        return value(node.expression as Node);
      case 'UnaryExpression':
        return ['-', '+'].includes(node.operator as string) ? value(node.argument as Node) : at(node, CALL);
      case 'BinaryExpression':
        if (!['+', '-', '*', '/', '%', '|'].includes(node.operator as string)) return at(node, BRANCH);
        value(node.left as Node);
        return value(node.right as Node);
      case 'MemberExpression':
        if (node.computed) return at(node, CALL);
        return value(node.object as Node);
      case 'ArrayExpression':
        for (const item of node.elements as Node[]) item?.type === 'SpreadElement' ? at(item, CALL) : value(item);
        return;
      case 'ObjectExpression':
        for (const prop of node.properties as Node[]) {
          if (prop.type !== 'Property' || prop.computed) at(prop, CALL);
          else value(prop.value as Node);
        }
        return;
      case 'JSXElement':
      case 'JSXFragment':
        return tsx(node);
      case 'ConditionalExpression':
      case 'LogicalExpression':
        return at(node, BRANCH);
      case 'ArrowFunctionExpression':
      case 'FunctionExpression':
        return at(node, HANDLER);
      case 'NewExpression':
        if (!constant) return at(node, NEW);
        value(node.callee as Node);
        for (const arg of node.arguments as Node[]) value(arg);
        return;
      case 'CallExpression': {
        const callee = node.callee as Node;
        const name = callee.type === 'Identifier' ? (callee.name as string) : callee.type === 'MemberExpression' ? ((callee.property as Node).name as string) : '';
        if (/^use[A-Z]/.test(name)) return at(node, HOOK);
        if (['map', 'forEach', 'from', 'flatMap', 'filter'].includes(name)) return at(node, LOOP);
        return at(node, CALL);
      }
      default:
        return at(node, CALL);
    }
  };

  /** An element: its attributes are values, its children elements, names or comments. */
  const tsx = (node: Node): void => {
    if (node.type === 'JSXElement') {
      for (const attr of (node.openingElement as Node).attributes as Node[]) {
        if (attr.type === 'JSXSpreadAttribute') at(attr, 'a scene spells out its attributes — no spread');
        else if ((attr.value as Node | null)?.type === 'JSXExpressionContainer') value((attr.value as Node).expression as Node);
      }
    }
    for (const child of node.children as Node[]) {
      if (child.type === 'JSXText') {
        const text = child.value as string;
        const lead = text.length - text.trimStart().length;
        if (text.trim()) at({ ...child, start: child.start + lead }, 'text in a scene is a value — an attribute, or a component\'s field');
      } else if (child.type === 'JSXExpressionContainer') {
        const inner = child.expression as Node;
        if (inner.type !== 'JSXEmptyExpression' && inner.type !== 'Identifier') value(inner);
      } else tsx(child);
    }
  };

  /** A factory: `() => <Tsx/>`, or a body of `const x = ref<T>()` and plain constants, then one `return`. */
  const factory = (fn: Node): void => {
    const body = fn.body as Node;
    if (body.type !== 'BlockStatement') return value(body);
    const statements = body.body as Node[];
    statements.forEach((statement, i) => {
      if (statement.type === 'ReturnStatement' && i === statements.length - 1) return value(statement.argument as Node);
      if (statement.type === 'VariableDeclaration' && statement.kind === 'const') {
        for (const d of statement.declarations as Node[]) {
          const init = d.init as Node | null;
          if (init?.type === 'CallExpression' && ((init.callee as Node).name as string) === 'ref') continue;
          value(init);
        }
        return;
      }
      at(statement, statement.type === 'IfStatement' ? BRANCH : /For|While/.test(statement.type) ? LOOP : HANDLER);
    });
  };

  const declaration = (node: Node): void => {
    if (node.type === 'FunctionDeclaration') return factory(node);
    if (node.type === 'VariableDeclaration') {
      if (node.kind !== 'const') return at(node, 'a scene declares constants only — const');
      for (const d of node.declarations as Node[]) {
        const init = d.init as Node | null;
        const wrapped = init?.type === 'CallExpression' && ((init.callee as Node).name as string) === 'prefab' ? ((init.arguments as Node[])[0] ?? null) : null;
        if (init && /Function/.test(init.type)) factory(init);
        else if (wrapped && /Function/.test(wrapped.type)) factory(wrapped);
        else if (init?.type === 'CallExpression' && ((init.callee as Node).name as string) === 'ref') {
          at(init, 'make a ref inside the function that uses it — one at module level is shared by every copy');
        } else {
          constant = true;
          value(init);
          constant = false;
        }
      }
      return;
    }
    if (node.type === 'ClassDeclaration') return at(node, 'a component is a class in a .ts file — a .tsx file is a scene');
    if (/^TS(Interface|TypeAlias)Declaration$/.test(node.type)) return;
    at(node, HANDLER);
  };

  for (const statement of program.body as Node[]) {
    if (statement.type === 'ImportDeclaration') continue;
    if (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration') {
      const inner = statement.declaration as Node | null;
      if (!inner) continue; // export { … } from
      if (statement.type === 'ExportDefaultDeclaration' && !/Declaration$/.test(inner.type)) {
        /Function/.test(inner.type) ? factory(inner) : value(inner);
      } else declaration(inner);
      continue;
    }
    declaration(statement);
  }
  return problems;
}

/** Every `.tsx` file under `dir`, past `node_modules`, `dist` and dotted folders. */
export function* tsxFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* tsxFiles(path);
    else if (path.endsWith('.tsx')) yield path;
  }
}
