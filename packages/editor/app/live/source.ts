/**
 * Where a standalone editor's documents come from.
 *
 * The server hands a page compiled modules; the standalone page has only text, and has to fetch
 * the documents a document refers to — a geometry, a material, a prefab — from wherever the first
 * one came from. Three places a document can come from, one interface.
 */

export interface Source {
  /** A short name for the picker: "examples", a folder's name, a host. */
  readonly label: string;
  /** The text at a path this source understands. */
  read(path: string): Promise<string>;
  /** A URL a `TextureLoader` can fetch, for a binary asset at a path. */
  url(path: string): Promise<string>;
  /** `ref` as written in the document at `from`, made into a path this source can read. */
  resolve(from: string, ref: string): string;
  /** The scenes and prefabs in here, if it can be listed. */
  list?(): Promise<Array<{ kind: string; path: string; stem: string }>>;
  /** Write text back, when this source can. */
  write?(path: string, text: string): Promise<void>;
}

/** Documents reachable by URL — the bundled examples, or any XML on the web. */
export class UrlSource implements Source {
  readonly label: string;
  constructor(label = 'web') {
    this.label = label;
  }
  async read(path: string): Promise<string> {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`);
    return response.text();
  }
  async url(path: string): Promise<string> {
    return path;
  }
  resolve(from: string, ref: string): string {
    return new URL(ref, new URL(from, location.href)).href;
  }
}

/** The file system access API, as much of it as is needed here. */
interface DirHandle {
  readonly name: string;
  values(): AsyncIterable<DirHandle | FileHandle>;
  getDirectoryHandle(name: string): Promise<DirHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
  readonly kind: 'directory';
}
interface FileHandle {
  readonly name: string;
  readonly kind: 'file';
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(text: string): Promise<void>; close(): Promise<void> }>;
}

/** A project folder the person picked — every document in it, and saves that go back to disk. */
export class FolderSource implements Source {
  readonly label: string;
  private readonly root: DirHandle;
  constructor(root: DirHandle) {
    this.root = root;
    this.label = root.name;
  }

  static async pick(): Promise<FolderSource | null> {
    const picker = (window as unknown as { showDirectoryPicker?: (o: object) => Promise<DirHandle> }).showDirectoryPicker;
    if (!picker) throw new Error('this browser cannot open a folder — Chrome and Edge can; or open a single file');
    try {
      return new FolderSource(await picker.call(window, { mode: 'readwrite' }));
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') return null;
      throw error;
    }
  }

  private async fileAt(path: string, create = false): Promise<FileHandle> {
    const parts = path.split('/').filter((p) => p && p !== '.');
    let dir = this.root;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    return dir.getFileHandle(parts[parts.length - 1]!, { create });
  }
  async read(path: string): Promise<string> {
    return (await (await this.fileAt(path)).getFile()).text();
  }
  async url(path: string): Promise<string> {
    return URL.createObjectURL(await (await this.fileAt(path)).getFile());
  }
  resolve(from: string, ref: string): string {
    return joinPath(from.split('/').slice(0, -1).join('/'), ref);
  }
  async list(): Promise<Array<{ kind: string; path: string; stem: string }>> {
    const found: Array<{ kind: string; path: string; stem: string }> = [];
    const walk = async (dir: DirHandle, prefix: string, depth: number): Promise<void> => {
      if (depth > 6) return;
      for await (const entry of dir.values()) {
        if (entry.kind === 'directory') {
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
          await walk(entry, `${prefix}${entry.name}/`, depth + 1);
        } else {
          const match = /^(.*)\.(scene|prefab)\.xml$/.exec(entry.name);
          if (match) found.push({ kind: match[2]!, path: `${prefix}${entry.name}`, stem: match[1]! });
        }
      }
    };
    await walk(this.root, '', 0);
    return found.sort((a, b) => a.path.localeCompare(b.path));
  }
  async write(path: string, text: string): Promise<void> {
    if (this.root.requestPermission && (await this.root.requestPermission({ mode: 'readwrite' })) !== 'granted') {
      throw new Error('the browser did not allow writing to this folder');
    }
    const writable = await (await this.fileAt(path, true)).createWritable();
    await writable.write(text);
    await writable.close();
  }
}

/** POSIX-style join with `..` resolved, for paths inside a picked folder. */
export function joinPath(dir: string, ref: string): string {
  const out: string[] = dir ? dir.split('/').filter(Boolean) : [];
  for (const part of ref.split('/')) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}
