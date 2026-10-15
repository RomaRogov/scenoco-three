/**
 * The scene files, as the game's dev server reads them (`scenoco()` in `@scenoco-three/tools/vite`).
 *
 * The page never sees the disk: it asks the server for a file's elements and asks it to write one
 * attribute at a time. An element is addressed by its index in document order, which an attribute
 * edit never changes — so the address worked out once, from where `jsxDEV` says an element was
 * written, stays good while the file's line and column numbers move under edits.
 */

export type Value = { kind: 'value'; value: unknown } | { kind: 'reference'; text: string };

export interface ElementJson {
  tag: string;
  line: number;
  column: number;
  parent: number;
  attributes: { name: string; text: string | null; value: Value }[];
}

export interface SceneJson {
  file: string;
  elements: ElementJson[];
}

/** An element of a scene file: which file, and which element in document order. */
export interface Address {
  file: string;
  index: number;
}

export class Docs {
  private readonly files = new Map<string, Promise<SceneJson>>();

  /** The element written at this line and column of `file`. */
  async locate(file: string, line: number, column: number): Promise<Address | null> {
    const doc = await this.read(file);
    const index = doc.elements.findIndex((e) => e.line === line && e.column === column);
    return index === -1 ? null : { file, index };
  }

  async element(address: Address): Promise<ElementJson | undefined> {
    return (await this.read(address.file)).elements[address.index];
  }

  read(file: string): Promise<SceneJson> {
    let doc = this.files.get(file);
    if (!doc) {
      doc = call<SceneJson>('GET', `scene?file=${encodeURIComponent(file)}`);
      this.files.set(file, doc);
      doc.catch(() => this.files.delete(file)); // a failed read is asked again next time
    }
    return doc;
  }

  /** Write one attribute; the server answers with the file as it now is. */
  async set(address: Address, name: string, value: unknown): Promise<void> {
    await this.post('set', address, { name, value });
  }

  /** Write an attribute's text exactly — `{-Math.PI / 2}`, or null for a bare flag. */
  async setText(address: Address, name: string, text: string | null): Promise<void> {
    await this.post('set', address, { name, text });
  }

  async remove(address: Address, name: string): Promise<void> {
    await this.post('remove', address, { name });
  }

  /**
   * Every write says which element it means, as last read, so the server refuses one aimed at a
   * file that changed behind the editor's back — and the next read is fresh.
   */
  private async post(route: string, address: Address, body: object): Promise<void> {
    const { file, index } = address;
    const element = await this.element(address);
    const expect = element && { tag: element.tag, line: element.line, column: element.column };
    const next = call<SceneJson>('POST', route, { file, index, expect, ...body });
    this.files.set(file, next);
    next.catch(() => this.files.delete(file));
    await next;
  }
}

async function call<T>(method: string, route: string, body?: object): Promise<T> {
  const response = await fetch(`/__scenoco/${route}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await response.json().catch(() => ({ error: `${response.status} ${response.statusText}` }))) as T & { error?: string };
  if (!response.ok || json.error) {
    throw new Error(
      json.error ?? `${response.status}` + (response.status === 404 ? ' — is `scenoco()` in this project’s vite.config plugins?' : ''),
    );
  }
  return json;
}
