/**
 * Dev only: `?drive=` — the game driven from the page's address, for a tool that can open a page,
 * read its console and take a screenshot, but not run JavaScript in it.
 *
 * `?drive=press('Space');until(GameState.phase == 'playing');read(count(Brick))`
 *
 * What it reads is data, never code: the text is parsed here and evaluated by walking it, so an
 * address — anyone's link — reaches the bridge's calls and the game's fields, and nothing else. There
 * are no calls but the few named below, and no `constructor`, `prototype` or `__` member, so nothing
 * leads to `Function`, `fetch` or the page's storage. A check this cannot say belongs in the game: a
 * getter on a behaviour, which this reads like a field.
 */

type Node =
  | { k: 'lit'; v: unknown }
  | { k: 'name'; n: string }
  | { k: 'node'; n: string }
  | { k: 'mem'; o: Node; p: string }
  | { k: 'idx'; o: Node; i: Node }
  | { k: 'call'; f: string; args: Node[] }
  | { k: 'un'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'arr'; items: Node[] }
  | { k: 'obj'; entries: [string, Node][] };

/** What an expression reads the game through. */
export interface DriveScope {
  /** A behaviour class by name, if the game has one. */
  type(name: string): unknown;
  /** Every live behaviour of a class. */
  live(name: string): object[];
  /** `Player.lane`: the first live Player, unless only the class has `lane`. */
  of(name: string, member: string): unknown;
  /** A node by its name; throws, naming the ones there are. */
  node(name: string): unknown;
  /** Time, scene, camera. */
  globals: Record<string, unknown>;
}

const OPS = ['===', '!==', '==', '!=', '<=', '>=', '&&', '||', '<', '>', '+', '-', '*', '/', '%', '!', '(', ')', '[', ']', '{', '}', ',', '.', ':', ';'];
const PRECEDENCE: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '===': 3, '!==': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
/** The calls an expression may make: lookups by class or name, no more. */
const FUNCTIONS = ['count', 'find', 'findAll', 'node'];
const UNSAFE = /^(constructor|prototype|__.*)$/;

type Token = { t: 'num' | 'str' | 'name' | 'hash' | 'op'; v: string };

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (/\s/.test(c)) i++;
    else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] ?? ''))) {
      const m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(text.slice(i))!;
      out.push({ t: 'num', v: m[0] });
      i += m[0].length;
    } else if (c === '"' || c === "'") {
      let s = '';
      for (i++; i < text.length && text[i] !== c; i++) s += text[i] === '\\' ? text[++i] : text[i];
      if (i >= text.length) throw new Error(`a string is not closed: ${c}${s}`);
      out.push({ t: 'str', v: s });
      i++;
    } else if (/[A-Za-z_$#]/.test(c)) {
      const m = /^#?[A-Za-z_$][\w$-]*/.exec(text.slice(i))!;
      out.push(m[0][0] === '#' ? { t: 'hash', v: m[0].slice(1) } : { t: 'name', v: m[0] });
      i += m[0].length;
    } else {
      const op = OPS.find((o) => text.startsWith(o, i));
      if (!op) throw new Error(`"${c}" is not something drive reads`);
      out.push({ t: 'op', v: op });
      i += op.length;
    }
  }
  return out;
}

class Parser {
  private at = 0;
  private readonly tokens: Token[];
  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }
  peek(v?: string): boolean {
    const t = this.tokens[this.at];
    return !!t && (v === undefined || (t.t === 'op' && t.v === v));
  }
  take(v: string): void {
    if (!this.peek(v)) throw new Error(`expected "${v}"${this.tokens[this.at] ? ` at "${this.tokens[this.at]!.v}"` : ' at the end'}`);
    this.at++;
  }
  done(): boolean {
    return this.at >= this.tokens.length;
  }
  expression(min = 0): Node {
    let left = this.unary();
    for (;;) {
      const t = this.tokens[this.at];
      const p = t?.t === 'op' ? PRECEDENCE[t.v] : undefined;
      if (p === undefined || p <= min) return left;
      this.at++;
      left = { k: 'bin', op: t!.v, a: left, b: this.expression(p) };
    }
  }
  private unary(): Node {
    if (this.peek('!') || this.peek('-')) {
      const op = this.tokens[this.at++]!.v;
      return { k: 'un', op, a: this.unary() };
    }
    return this.postfix(this.primary());
  }
  private postfix(node: Node): Node {
    for (;;) {
      if (this.peek('.')) {
        this.at++;
        const t = this.tokens[this.at++];
        if (t?.t !== 'name') throw new Error('a "." is followed by a field name');
        node = { k: 'mem', o: node, p: t.v };
      } else if (this.peek('[')) {
        this.at++;
        node = { k: 'idx', o: node, i: this.expression() };
        this.take(']');
      } else return node;
    }
  }
  private list(close: string): Node[] {
    const items: Node[] = [];
    while (!this.peek(close)) {
      items.push(this.expression());
      if (!this.peek(close)) this.take(',');
    }
    this.take(close);
    return items;
  }
  private primary(): Node {
    const t = this.tokens[this.at++];
    if (!t) throw new Error('it ends where a value should be');
    if (t.t === 'num') return { k: 'lit', v: Number(t.v) };
    if (t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'hash') return { k: 'node', n: t.v };
    if (t.t === 'name') {
      if (t.v === 'true' || t.v === 'false') return { k: 'lit', v: t.v === 'true' };
      if (t.v === 'null') return { k: 'lit', v: null };
      if (this.peek('(')) {
        this.at++;
        return { k: 'call', f: t.v, args: this.list(')') };
      }
      return { k: 'name', n: t.v };
    }
    if (t.v === '(') {
      const inner = this.expression();
      this.take(')');
      return inner;
    }
    if (t.v === '[') return { k: 'arr', items: this.list(']') };
    if (t.v === '{') {
      const entries: [string, Node][] = [];
      while (!this.peek('}')) {
        const key = this.tokens[this.at++];
        if (key?.t !== 'name' && key?.t !== 'str') throw new Error('an object\'s keys are names: { cameraPos: [0, 10, 0] }');
        this.take(':');
        entries.push([key.v, this.expression()]);
        if (!this.peek('}')) this.take(',');
      }
      this.take('}');
      return { k: 'obj', entries };
    }
    throw new Error(`"${t.v}" cannot start a value`);
  }
}

/** An expression — written as itself or as a string — read against the game whenever it is called. */
export function reader(node: DriveNode, scope: DriveScope): () => unknown {
  const parsed = node.k === 'lit' && typeof node.v === 'string' ? whole(node.v) : node;
  return () => evaluate(parsed, scope);
}

function whole(text: string): Node {
  const p = new Parser(tokenize(text));
  const node = p.expression();
  if (!p.done()) throw new Error(`"${text}" goes on after its value`);
  return node;
}

/** A class named alone: what `GameState.phase` and `count(GameState)` read. */
class ClassRef {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
}

function evaluate(node: Node, scope: DriveScope): unknown {
  switch (node.k) {
    case 'lit':
      return node.v;
    case 'arr':
      return node.items.map((n) => evaluate(n, scope));
    case 'obj':
      return Object.fromEntries(node.entries.map(([k, n]) => [k, evaluate(n, scope)]));
    case 'node':
      return scope.node(node.n);
    case 'name': {
      if (Object.hasOwn(scope.globals, node.n)) return scope.globals[node.n];
      if (scope.type(node.n)) return new ClassRef(node.n);
      throw new Error(`${node.n} is not a behaviour class of this game, nor Time, scene or camera`);
    }
    case 'mem': {
      if (UNSAFE.test(node.p)) throw new Error(`drive does not read ${node.p}`);
      const owner = evaluate(node.o, scope);
      const from = owner instanceof ClassRef ? scope.of(owner.name, node.p) : owner;
      return member(from, node.p);
    }
    case 'idx': {
      const key = evaluate(node.i, scope);
      if (typeof key !== 'number' && (typeof key !== 'string' || UNSAFE.test(key))) throw new Error(`drive reads [${JSON.stringify(key)}] only as a number or a field name`);
      return member(evaluate(node.o, scope), key);
    }
    case 'call': {
      if (!FUNCTIONS.includes(node.f)) throw new Error(`${node.f}() is not something drive calls — in a reading: ${FUNCTIONS.join(', ')}. A method's answer is read through a getter on the behaviour.`);
      const arg = evaluate(node.args[0] ?? { k: 'lit', v: undefined }, scope);
      if (node.f === 'node') return scope.node(String(arg));
      const name = arg instanceof ClassRef ? arg.name : String(arg);
      const live = scope.live(name);
      return node.f === 'count' ? live.length : node.f === 'find' ? (live[0] ?? null) : live;
    }
    case 'un': {
      const a = evaluate(node.a, scope);
      return node.op === '!' ? !a : -(a as number);
    }
    case 'bin': {
      if (node.op === '&&') return evaluate(node.a, scope) && evaluate(node.b, scope);
      if (node.op === '||') return evaluate(node.a, scope) || evaluate(node.b, scope);
      const a = evaluate(node.a, scope) as number;
      const b = evaluate(node.b, scope) as number;
      switch (node.op) {
        // `==` reads as `===`: a value of the game compared with a literal, never coerced.
        case '==': case '===': return a === b;
        case '!=': case '!==': return a !== b;
        case '<': return a < b;
        case '<=': return a <= b;
        case '>': return a > b;
        case '>=': return a >= b;
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
        default: return a % b;
      }
    }
  }
}

function member(owner: unknown, key: string | number): unknown {
  if (owner == null) throw new Error(`cannot read ${key} of ${owner}`);
  const value = (owner as Record<string | number, unknown>)[key];
  if (typeof value === 'function') throw new Error(`${key} is a method — drive reads fields and getters; give the behaviour a getter that answers it`);
  return value;
}

export type DriveNode = Node;

/** One statement of `?drive=`: a bridge call and its arguments, unread. */
export interface DriveCall {
  name: string;
  args: Node[];
}

/** `press('Space');until(Game.over)`: the calls, in order. */
export function parseDrive(text: string): DriveCall[] {
  const p = new Parser(tokenize(text));
  const calls: DriveCall[] = [];
  while (!p.done()) {
    const node = p.expression();
    if (node.k !== 'call') throw new Error('drive is calls separated by ";": press(\'Space\');until(GameState.phase == \'playing\');outline()');
    calls.push({ name: node.f, args: node.args });
    if (!p.done()) p.take(';');
  }
  return calls;
}

/** A literal argument's value: `step(60)`, `view({ cameraPos: [0, 10, 0] })`. */
export function value(node: Node, scope: DriveScope): unknown {
  return evaluate(node, scope);
}

/** An argument as written, for the console line that answers it. */
export function source(node: Node, nested = false): string {
  const at = (n: Node) => source(n, true);
  switch (node.k) {
    case 'lit': return typeof node.v === 'string' ? JSON.stringify(node.v) : String(node.v);
    case 'name': return node.n;
    case 'node': return `#${node.n}`;
    case 'mem': return `${at(node.o)}.${node.p}`;
    case 'idx': return `${at(node.o)}[${source(node.i)}]`;
    case 'call': return `${node.f}(${node.args.map((a) => source(a)).join(', ')})`;
    case 'un': return `${node.op}${at(node.a)}`;
    case 'bin': return nested ? `(${at(node.a)} ${node.op} ${at(node.b)})` : `${at(node.a)} ${node.op} ${at(node.b)}`;
    case 'arr': return `[${node.items.map((a) => source(a)).join(', ')}]`;
    case 'obj': return `{ ${node.entries.map(([k, n]) => `${k}: ${source(n)}`).join(', ')} }`;
  }
}
