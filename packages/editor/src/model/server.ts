/**
 * The dev server, as the editor asks it (`scenoco()` in `@scenoco-three/tools/vite`): a scene file's
 * elements, what the project's TypeScript says of them, and one attribute written at a time.
 */
import type { Source } from '@scenoco-three/core';
import type { Address, Field, TextLink, Where } from './types.js';

/** An element's class as declared: what its fields are, which are private, and its constructors. */
export interface ElementTypes {
  element: number;
  fields: Record<string, Field>;
  hidden: string[];
  constructors: { name: string; field?: Field }[][];
  /** A function's tag: each prop's value when the tag leaves it out. */
  defaults?: Record<string, unknown>;
}

export interface ElementJson {
  tag: string;
  owner?: string;
  line: number;
  column: number;
  attributes: { name: string; text: string | null; items?: string[] }[];
}

export interface FileJson {
  file: string;
  elements: ElementJson[];
}

/** How long a question the dev server could not answer waits before it is asked again. */
const RETRY_MS = 5000;

/**
 * The project's scene files as the dev server reads them — each element, where it was written, the
 * constant it is in — with what its TypeScript declares of them, asked for once a file and kept.
 */
export class SceneFiles {
  private readonly files = new Map<string, Promise<FileJson>>();

  /** Each file's elements by where `jsxDEV` says they were written — the file as the page loaded it. */
  private readonly indexes = new Map<string, Map<string, number>>();

  private readonly tags = new Map<string, Map<string, string>>();

  private readonly owners = new Map<string, Map<string, string>>();
  /** Each file's elements as declared, by index, once the dev server answered. */
  private readonly types = new Map<string, Map<number, ElementTypes> | 'asking'>();
  /** Each file's links, by element index and attribute, once the dev server answered: TypeScript's own. */
  private readonly links = new Map<string, Map<string, TextLink[]> | 'asking'>();
  /** The project's scenes, which the editor can open: from the dev server. */
  scenes: { file: string; name: string }[] = [];
  private custom: Promise<string | null> | undefined;
  /** Called when an answer came that changes what is shown. */
  private readonly changed: () => void;
  /** Where a refusal is said. */
  private readonly say: (text: string, error: boolean) => void;

  constructor(changed: () => void, say: (text: string, error: boolean) => void) {
    this.changed = changed;
    this.say = say;
    call<{ file: string; name: string }[]>('GET', 'scenes').then(
      (scenes) => {
        this.scenes = scenes;
        this.changed();
      },
      () => {},
    );
  }

  read(file: string): Promise<FileJson> {
    let doc = this.files.get(file);
    if (!doc) {
      doc = call<FileJson>('GET', `scene?file=${encodeURIComponent(file)}`).then((json) => {
        // Where each element was when the page loaded: what every later `sourceOf` reports.
        if (!this.indexes.has(file)) {
          this.indexes.set(file, new Map(json.elements.map((e, i) => [`${e.line}:${e.column}`, i])));
          this.tags.set(file, new Map(json.elements.map((e) => [`${e.line}:${e.column}`, e.tag])));
          this.owners.set(file, new Map(json.elements.flatMap((e) => (e.owner ? [[`${e.line}:${e.column}`, e.owner] as const] : []))));
        }
        return json;
      });
      this.files.set(file, doc);
      doc.catch(() => this.files.delete(file));
    }
    return doc;
  }

  async element(address: Address): Promise<ElementJson | undefined> {
    return (await this.read(address.file)).elements[address.index];
  }

  async addressFor(source: Source): Promise<Address | null> {
    await this.read(source.fileName);
    const index = this.indexes.get(source.fileName)?.get(`${source.lineNumber}:${source.columnNumber}`);
    return index === undefined ? null : { file: source.fileName, index };
  }

  /** An element's class as the project declares it; asked for once a file, in the background. */
  typesOf(address: Address | null): ElementTypes | undefined {
    if (!address) return undefined;
    const known = this.types.get(address.file);
    if (known === undefined) {
      this.types.set(address.file, 'asking');
      call<ElementTypes[]>('GET', `types?file=${encodeURIComponent(address.file)}`).then(
        (list) => {
          this.types.set(address.file, new Map(list.map((t) => [t.element, t])));
          this.changed();
        },
        () => {
          // Nothing known for now; asked again in a while, not on every redraw.
          this.types.set(address.file, new Map());
          setTimeout(() => this.types.delete(address.file), RETRY_MS);
        },
      );
    }
    return known instanceof Map ? known.get(address.index) : undefined;
  }

  /** The names in an attribute's text, linked to where they are declared; asked for once a file, in the background. */
  linksOf(address: Address, name: string): TextLink[] | undefined {
    const known = this.links.get(address.file);
    if (known === undefined) {
      this.links.set(address.file, 'asking');
      call<{ element: number; name: string; from: number; to: number; file: string; line: number; column: number }[]>('GET', `links?file=${encodeURIComponent(address.file)}`).then(
        (list) => {
          const byAttribute = new Map<string, TextLink[]>();
          for (const l of list) {
            const key = `${l.element}#${l.name}`;
            byAttribute.set(key, [...(byAttribute.get(key) ?? []), { from: l.from, to: l.to, where: { label: `${short(l.file)}:${l.line}`, file: l.file, line: l.line, col: l.column } }]);
          }
          this.links.set(address.file, byAttribute);
          this.changed();
        },
        () => {
          this.links.set(address.file, new Map());
          setTimeout(() => this.links.delete(address.file), RETRY_MS);
        },
      );
    }
    return known instanceof Map ? known.get(`${address.index}#${name}`) : undefined;
  }

  /** The constant an element is written in, once its file is read; asking reads it. */
  ownerAt(source: Source): string | undefined {
    const owners = this.owners.get(source.fileName);
    if (!owners && !this.files.has(source.fileName)) void this.read(source.fileName).then(() => this.changed(), () => {});
    return owners?.get(`${source.lineNumber}:${source.columnNumber}`);
  }

  /** The tag an element was written as, once its file is read; asking reads it. */
  tagAt(source: Source): string | undefined {
    const tags = this.tags.get(source.fileName);
    // Read once; when it comes, the interface asks again.
    if (!tags && !this.files.has(source.fileName)) void this.read(source.fileName).then(() => this.changed(), () => {});
    return tags?.get(`${source.lineNumber}:${source.columnNumber}`);
  }

  /** One attribute written, or (null) taken out; false when the server refused, which the status line then says. */
  async write(address: Address, name: string, what: { value: unknown } | { text: string | null } | null): Promise<boolean> {
    try {
      const element = await this.element(address);
      if (!element) throw new Error('the element is gone from its file');
      const body = { file: address.file, index: address.index, expect: { tag: element.tag, line: element.line, column: element.column }, name, ...what };
      this.files.set(address.file, Promise.resolve(await call<FileJson>('POST', what ? 'set' : 'remove', body)));
      // The file moved under its links: they are asked for again.
      this.links.delete(address.file);
      return true;
    } catch (error) {
      this.say(error instanceof Error ? error.message : String(error), true);
      return false;
    }
  }

  /** The command the project set for opening files, read once: null when it set none. */
  customCommand(): Promise<string | null> {
    this.custom ??= call<{ custom: string | null }>('GET', 'open').then((a) => a.custom, () => null);
    return this.custom;
  }
}

export function where(source: Source): Where {
  return { label: `${short(source.fileName)}:${source.lineNumber}`, file: source.fileName, line: source.lineNumber, col: source.columnNumber };
}

export function sourceKey(source: Source | undefined): string | undefined {
  return source && `${source.fileName}:${source.lineNumber}:${source.columnNumber}`;
}

export function keyOf(address: Address, name: string): string {
  return `${address.file}#${address.index}#${name}`;
}

export function short(file: string): string {
  return file.split('/').pop() ?? file;
}

export async function call<T>(method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
  const res = await fetch(`/__scenoco/${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `${res.status} ${res.statusText}`);
  if (method === 'POST' && body) told(path, body as Written);
  return json;
}

type Written = { file?: string; name?: string; value?: unknown; expect?: { tag?: string } };

/** A line for whoever else edits the file — an agent reading the console: the file changed under it. */
function told(path: string, { file, name, value, expect }: Written): void {
  const what = { set: `${name}=${JSON.stringify(value)}`, remove: `${name} removed`, duplicate: 'duplicated', delete: 'deleted' }[path];
  if (!what || !file) return;
  console.info(`SceNoCo: the editor wrote ${file}: <${expect?.tag ?? '?'}> ${what}. Read the file again before editing it.`);
}
