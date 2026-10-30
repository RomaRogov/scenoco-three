/**
 * A behaviour's class, read from its TypeScript, as the outline of its C# port: every field, every
 * method with a C# signature, and each method's TypeScript inside it as comments — so a port is
 * written in place, method by method, with nothing to look up in the original.
 *
 * Only signatures are translated, and only where the type says what to write; the rest is the
 * port's to decide. What a stub holds compiles as it is: a method returns its default until it is
 * written, and a field whose C# type is not obvious stays a comment.
 */
import { parseSync } from 'rolldown/utils';

/** One member of the class, as written. */
interface Member {
  kind: 'field' | 'method' | 'get' | 'set' | 'constructor';
  name: string;
  isStatic: boolean;
  access: 'public' | 'private' | 'protected';
  /** The member's own text, from its first modifier to its end. */
  text: string;
  /** Its doc comment's lines, without the comment markers. */
  doc: string[];
  /** A method's: what comes before its body, and its body's lines. */
  head?: string;
  body?: string[];
  params?: { name: string; type: string }[];
  returns?: string;
}

export interface ClassSource {
  doc: string[];
  /** The class it extends, as written. */
  base?: string;
  members: Member[];
}

/** Unity's messages, which a behaviour's hooks of the same name become: `update` is `Update`. */
const MESSAGES = new Set(
  ('awake start update lateUpdate fixedUpdate onEnable onDisable onDestroy onValidate reset onApplicationPause ' +
    'onApplicationFocus onApplicationQuit onBecameVisible onBecameInvisible onCollisionEnter onCollisionStay onCollisionExit ' +
    'onTriggerEnter onTriggerStay onTriggerExit onCollisionEnter2D onCollisionStay2D onCollisionExit2D onTriggerEnter2D ' +
    'onTriggerStay2D onTriggerExit2D onControllerColliderHit onMouseDown onMouseUp onMouseEnter onMouseExit onMouseOver ' +
    'onMouseDrag onMouseUpAsButton onAnimatorMove onAnimatorIK onDrawGizmos onDrawGizmosSelected')
    .split(' '),
);

/** Names that mean the same in Unity. */
/** The messages Unity calls with an argument; every other one takes none. */
const WITH_ARGUMENT = /^on(Collision|Trigger)(Enter|Stay|Exit)(2D)?$|^onControllerColliderHit$|^onApplication(Pause|Focus)$|^onAnimatorIK$/;

const SAME = new Set('Vector2 Vector3 Vector4 Quaternion Color Collision Collision2D Collider Collider2D Camera Light AudioClip Texture Texture2D Material Mesh Ray Plane Bounds'.split(' '));

const KEYWORDS = new Set(
  ('abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum ' +
    'event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace ' +
    'new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc ' +
    'static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while')
    .split(' '),
);

const pascal = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);
const safe = (name: string) => (KEYWORDS.has(name) ? `@${name}` : name);

/** The class `name` declared in `code`, or undefined when it is not there. */
export function readClass(code: string, file: string, name: string): ClassSource | undefined {
  const { program, comments } = parseSync(file, code, { lang: file.endsWith('.tsx') ? 'tsx' : 'ts' }) as unknown as {
    program: { body: Node[] };
    comments: { type: string; value: string; start: number; end: number }[];
  };
  const docBefore = (start: number): string[] => {
    const comment = comments.filter((c) => c.end <= start && c.type === 'Block' && c.value.startsWith('*')).at(-1);
    if (!comment || code.slice(comment.end, start).trim() !== '') return [];
    return comment.value
      .split('\n')
      .map((line) => line.replace(/^\s*\*+ ?/, '').trimEnd())
      .filter((line, i, all) => line !== '' || (i > 0 && i < all.length - 1));
  };
  const declaration = program.body
    .map((s) => (s.type === 'ExportNamedDeclaration' || s.type === 'ExportDefaultDeclaration' ? (s.declaration as Node) : s))
    .find((s) => s?.type === 'ClassDeclaration' && (s.id as Node | null)?.name === name);
  if (!declaration) return undefined;
  const typeText = (t: Node | null | undefined) => (t ? code.slice((t.typeAnnotation as Node).start, (t.typeAnnotation as Node).end) : '');

  const members: Member[] = [];
  for (const m of (declaration.body as Node).body as Node[]) {
    const key = m.key as Node | undefined;
    if (!key || (key.type !== 'Identifier' && key.type !== 'PrivateIdentifier')) continue;
    const base = {
      name: key.name as string,
      isStatic: Boolean(m.static),
      access: ((m.accessibility as string | null) ?? (key.type === 'PrivateIdentifier' ? 'private' : 'public')) as Member['access'],
      text: code.slice(m.start, m.end),
      doc: docBefore(m.start),
    };
    if (m.type === 'PropertyDefinition') {
      members.push({ ...base, kind: 'field' });
    } else if (m.type === 'MethodDefinition') {
      const fn = m.value as Node;
      const body = fn.body as Node | null;
      if (!body) continue;
      const params = (fn.params as Node[]).map((p) => {
        const id = (p.type === 'AssignmentPattern' ? p.left : p.type === 'TSParameterProperty' ? p.parameter : p) as Node;
        return { name: (id.name as string | undefined) ?? 'arg', type: typeText(id.typeAnnotation as Node | null) };
      });
      let returns = typeText(fn.returnType as Node | null);
      if (!returns) returns = fn.generator ? 'Generator' : fn.async ? 'Promise<void>' : returnsValue(body) ? 'unknown' : 'void';
      else if (fn.async && !returns.startsWith('Promise')) returns = `Promise<${returns}>`;
      members.push({
        ...base,
        kind: m.kind as Member['kind'],
        head: code.slice(m.start, body.start).replace(/\s+/g, ' ').trim(),
        body: dedent(code.slice(body.start + 1, body.end - 1)),
        params,
        returns,
      });
    }
  }
  const superClass = declaration.superClass as Node | null;
  return { doc: docBefore(declaration.start), base: superClass ? code.slice(superClass.start, superClass.end) : undefined, members };
}

type Node = { type: string; start: number; end: number; [key: string]: unknown };

/**
 * A module's code outside the classes named — its imports left out too: the interfaces, types,
 * constants and functions a behaviour's file holds beside it, which no stub carries.
 */
export function outsideClasses(code: string, file: string, classes: string[]): string[] {
  const { program } = parseSync(file, code, { lang: file.endsWith('.tsx') ? 'tsx' : 'ts' }) as unknown as { program: { body: Node[] } };
  const cut: [number, number][] = [];
  for (const statement of program.body) {
    const inner = (statement.declaration as Node | undefined) ?? statement;
    if (statement.type === 'ImportDeclaration' || (inner.type === 'ClassDeclaration' && classes.includes((inner.id as Node | null)?.name as string)))
      cut.push([statement.start, statement.end]);
  }
  let text = '';
  let from = 0;
  for (const [a, b] of cut) {
    text += code.slice(from, a);
    from = b;
  }
  text += code.slice(from);
  // The doc comment of a class that was cut stays behind it: drop a comment left with nothing after it.
  return text
    .replace(/\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*(?=\n\s*\n|$)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .split('\n')
    .filter((_, i, lines) => lines.join('').trim() !== '');
}

/** A module no behaviour lives in, as a `.cs` holding its TypeScript for a port to write. */
export function moduleStub(file: string, code: string): string {
  return [
    `// Ported from ${file.replace(/^\//, '')}, which holds no behaviour. Its TypeScript is below, as it is: port it as`,
    '// C# where the game needs it — a static class for helpers, an enum for a union of names, a',
    '// ScriptableObject for data a designer tunes — then delete the comment. Assets/SceNoCo/PORTING.md',
    '// has the rules. Written by scenoco-unity once, never overwritten.',
    '//',
    ...code.replace(/\s+$/, '').split('\n').map((l) => (l ? `// ${l}` : '//')),
    '',
  ].join('\n');
}

/** Whether a function body returns a value — its own returns, not those of a function inside it. */
function returnsValue(body: Node): boolean {
  const visit = (n: unknown): boolean => {
    if (!n || typeof n !== 'object') return false;
    if (Array.isArray(n)) return n.some(visit);
    const node = n as Node;
    if (/Function|ArrowFunction|ClassBody/.test(node.type ?? '')) return false;
    if (node.type === 'ReturnStatement') return node.argument != null;
    return Object.values(node).some((v) => typeof v === 'object' && visit(v));
  };
  return (body.body as Node[]).some(visit);
}

function dedent(text: string): string[] {
  const lines = text.replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n');
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length));
  return lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0).trimEnd());
}

/**
 * A TypeScript type as C#, where the type says it: `number` is `float`, a node is its `Transform`,
 * an element of the page is a `VisualElement`. Undefined when it does not.
 */
export function csType(ts: string, classes: Map<string, string>): string | undefined {
  const t = ts.trim().replace(/^readonly\s+/, '');
  if (!t) return undefined;
  const parts = splitTop(t, '|').map((p) => p.trim()).filter((p) => p !== 'null' && p !== 'undefined');
  if (parts.length > 1) {
    if (parts.every((p) => /^(['"]).*\1$/.test(p))) return 'string';
    if (parts.every((p) => /^-?\d/.test(p))) return 'float';
    return undefined;
  }
  const one = parts[0] ?? '';
  if (one.startsWith('(') && one.endsWith(')')) return csType(one.slice(1, -1), classes);
  if (one.endsWith('[]')) {
    const inner = csType(one.slice(0, -2), classes);
    return inner && inner !== 'void' ? `${inner}[]` : undefined;
  }
  if (/^(['"]).*\1$/.test(one)) return 'string';
  if (/^-?\d/.test(one)) return 'float';
  if (one === 'number') return 'float';
  if (one === 'boolean' || one === 'true' || one === 'false') return 'bool';
  if (one === 'string') return 'string';
  if (one === 'void' || one === 'undefined') return 'void';
  const generic = /^(\w+)(?:<(.*)>)?$/.exec(one);
  if (!generic) return undefined;
  const [, name, args] = generic as unknown as [string, string, string | undefined];
  if (name === 'Array' && args) return csType(`${args}[]`, classes);
  if (name === 'Generator' || name === 'Iterator' || name === 'IterableIterator') return 'IEnumerator';
  if (name === 'Promise') {
    const inner = args ? csType(args, classes) : 'void';
    return inner === 'void' ? 'Awaitable' : inner ? `Awaitable<${inner}>` : undefined;
  }
  if (SAME.has(name)) return name;
  if (name === 'Object3D' || name === 'Group' || name === 'Mesh' || name === 'Scene') return 'Transform';
  if (name === 'Behaviour') return 'MonoBehaviour';
  if (/^HTML\w*Element$/.test(name)) return 'VisualElement';
  return classes.get(name);
}

/** `text` split at `separator` where it is not inside brackets of any kind. */
function splitTop(text: string, separator: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if ('<([{'.includes(c)) depth++;
    else if ('>)]}'.includes(c)) depth--;
    else if (c === separator && depth === 0) {
      out.push(text.slice(from, i));
      from = i + 1;
    }
  }
  out.push(text.slice(from));
  return out;
}

/**
 * The C# class for a behaviour: `wired` are the fields its scenes and prefabs set — real fields, with
 * the C# the exporter already chose for them — and everything else comes from its TypeScript.
 */
export function stubClass(
  name: string,
  file: string,
  source: ClassSource,
  wired: Map<string, string>,
  classes: Map<string, string>,
  outside: string[] = [],
): string {
  const lines: string[] = [];
  const comment = (text: string[], indent: string) => text.map((l) => (l ? `${indent}// ${l}` : `${indent}//`));
  const base = source.base === 'Behaviour' || !source.base ? 'MonoBehaviour' : (classes.get(source.base) ?? 'MonoBehaviour');

  lines.push(...comment(source.doc, ''));
  if (source.doc.length) lines.push('//');
  lines.push(
    `// Ported from ${file.replace(/^\//, '')}. Each member below holds its TypeScript as comments: write the C# in`,
    '// its place, then delete the comment. Keep the field names: the prefabs are wired by them.',
    '// Assets/SceNoCo/PORTING.md has the rules. Written by scenoco-unity once, never overwritten.',
  );
  if (name !== source.base && base === 'MonoBehaviour' && source.base && source.base !== 'Behaviour') {
    lines.push(`// In TypeScript it extends ${source.base}, which has no C# class here.`);
  }
  lines.push(`public class ${name} : ${base}`, '{');

  const body: string[][] = [];
  const declared = new Set(source.members.filter((m) => m.kind === 'field').map((m) => m.name));
  // Wired fields an ancestor declares: still real fields, so the prefabs keep their values.
  for (const [field, line] of wired) if (!declared.has(field)) body.push([line]);

  for (const m of source.members) {
    const block: string[] = comment(m.doc, '    ');
    if (m.kind === 'field') {
      const real = wired.get(m.name);
      if (real) block.push(real);
      else block.push(...comment(m.text.split('\n').map((l) => l.trim()), '    '));
    } else if (m.kind === 'constructor') {
      block.push('    // A MonoBehaviour has no constructor: what this one does belongs in Awake.', ...comment([`${m.head!} {`, ...m.body!.map((l) => `  ${l}`), '}'], '    '));
    } else if (m.kind === 'get' || m.kind === 'set') {
      continue;
    } else {
      block.push(...method(m, classes));
    }
    body.push(block);
  }
  body.push(...properties(source.members, classes));

  lines.push(...body.flatMap((b, i) => (i ? ['', ...b] : b)), '}', '');
  if (outside.length) {
    lines.push(
      `// Outside the class, in ${file.replace(/^\//, '')}: port it where the game needs it — an enum, a static class, a`,
      '// ScriptableObject — then delete the comment.',
      '//',
      ...outside.map((l) => (l ? `// ${l}` : '//')),
      '',
    );
  }
  const usings = ['using System.Collections;', 'using UnityEngine;'];
  if (lines.some((l) => !l.trimStart().startsWith('//') && l.includes('VisualElement'))) usings.push('using UnityEngine.UIElements;');
  return [...usings, '', ...lines].join('\n');
}

function method(m: Member, classes: Map<string, string>): string[] {
  const message = MESSAGES.has(m.name) && !m.isStatic;
  const returns = csType(m.returns!, classes) ?? 'object';
  // Core hands `update` the frame's time; Unity's Update takes nothing and reads Time.deltaTime.
  const dropped = message && !WITH_ARGUMENT.test(m.name) ? m.params! : [];
  const params = (dropped.length ? [] : m.params!).map((p) => `${csType(p.type, classes) ?? 'object'} ${safe(p.name)}`).join(', ');
  const modifiers = message ? '' : `${m.access} ${m.isStatic ? 'static ' : ''}`;
  const placeholder = returns === 'void' ? [] : returns === 'IEnumerator' ? ['        yield break;'] : ['        return default;'];
  return [
    `    ${modifiers}${returns} ${pascal(m.name)}(${params})`,
    '    {',
    ...dropped.map((p) => `        // Unity passes no ${p.name}: ${m.name === 'fixedUpdate' ? 'Time.fixedDeltaTime' : 'Time.deltaTime'} is the frame's time.`),
    `        // ${m.head} {`,
    ...m.body!.map((l) => (l ? `        //   ${l}` : '        //')),
    '        // }',
    ...placeholder,
    '    }',
  ];
}

/** Getters and setters as C# properties, one per name. */
function properties(members: Member[], classes: Map<string, string>): string[][] {
  const out: string[][] = [];
  const names = [...new Set(members.filter((m) => m.kind === 'get' || m.kind === 'set').map((m) => m.name))];
  for (const name of names) {
    const get = members.find((m) => m.kind === 'get' && m.name === name);
    const set = members.find((m) => m.kind === 'set' && m.name === name);
    const first = get ?? set!;
    const type = csType(get?.returns ?? set?.params?.[0]?.type ?? '', classes) ?? 'object';
    const accessor = (m: Member, word: string, placeholder: string[]) => [
      `        ${word}`,
      '        {',
      `            // ${m.head} {`,
      ...m.body!.map((l) => (l ? `            //   ${l}` : '            //')),
      '            // }',
      ...placeholder,
      '        }',
    ];
    out.push([
      ...first.doc.map((l) => (l ? `    // ${l}` : '    //')),
      `    ${first.access} ${first.isStatic ? 'static ' : ''}${type} ${pascal(name)}`,
      '    {',
      ...(get ? accessor(get, 'get', ['            return default;']) : []),
      ...(set ? accessor(set, 'set', []) : []),
      '    }',
    ]);
  }
  return out;
}
