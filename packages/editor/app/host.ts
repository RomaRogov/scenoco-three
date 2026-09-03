/**
 * Where the page's documents come from: a folder on this machine, or a URL.
 *
 * There is no server. The page parses the document itself, builds the scene live, and saves by
 * writing the file back — into the folder it was opened from, with the compiler's own edit
 * splices applied to the text.
 */
import type { ProjectModel } from '@scenoco-three/compiler';
import { indexDocument } from '@scenoco-three/compiler/browser';
import type { SceneType } from '@scenoco-three/core';
import type { Edit, RawElement } from './document.js';
import { buildLive, type Registry } from './live/build.js';
import { applyEdits } from './live/edits.js';
import { FolderSource, UrlSource, type Source } from './live/source.js';

export interface Pickable {
  kind: string;
  path: string;
  stem: string;
  /** Where it is from: the folder's name, or "examples". */
  group?: string;
}

export interface Opened {
  path: string;
  text: string;
  elements: RawElement[];
  scene: SceneType;
  /** What the live build could not honour. Never fatal: the rest still shows. */
  problems: string[];
}

export type Saved = { ok: true; text: string; elements: RawElement[] } | { ok: false; error: string };

export class Host {
  private folderSource: FolderSource | null = null;
  private opened: { path: string; source: Source } | null = null;
  private bundled: Promise<Pickable[]> | undefined;
  private modelPromise: Promise<ProjectModel> | undefined;
  private readonly registry: () => Promise<Registry>;

  constructor(registry: () => Promise<Registry>) {
    this.registry = registry;
  }

  /** The folder open right now, for the picker's heading; null before one is picked. */
  get folder(): string | null {
    return this.folderSource?.label ?? null;
  }

  /** The documents in the open folder, then the examples the site carries. */
  async documents(): Promise<Pickable[]> {
    const own = this.folderSource ? await this.folderSource.list() : [];
    const examples = await (this.bundled ??= fetch('./examples.json')
      .then((r) => (r.ok ? (r.json() as Promise<Pickable[]>) : []))
      .catch(() => [] as Pickable[]));
    return [...own.map((d) => ({ ...d, group: this.folderSource!.label })), ...examples];
  }

  model(): Promise<ProjectModel> {
    return (this.modelPromise ??= fetch('./model.json').then((r) => {
      if (!r.ok) throw new Error('this build has no model.json — run `npm run build:app` in packages/editor');
      return r.json() as Promise<ProjectModel>;
    }));
  }

  async open(path: string): Promise<Opened> {
    // A URL, or one of the bundled examples, is read from the web; anything else from the folder.
    const fromWeb = /^https?:/.test(path) || path.startsWith('examples/');
    const source: Source = fromWeb ? new UrlSource(/^https?:/.test(path) ? new URL(path).host : 'examples') : this.folderSource!;
    if (!source) throw new Error('open a folder first');
    const text = await source.read(path);
    const elements = indexDocument(text).map((e) => ({
      tag: e.tag,
      line: e.line,
      column: e.column,
      start: e.start,
      end: e.end,
      attributes: e.attributes instanceof Map ? Object.fromEntries(e.attributes) : e.attributes,
    })) as RawElement[];
    const live = await buildLive(path, source, await this.model(), await this.registry());
    this.opened = { path, source };
    return { path, text, elements, scene: live.SceneClass, problems: live.problems };
  }

  async save(path: string, edits: readonly Edit[]): Promise<Saved> {
    const source = this.opened?.path === path ? this.opened.source : this.folderSource;
    if (!source?.write) {
      return { ok: false, error: 'this document came from the web, which cannot be written to — open a folder to save' };
    }
    const current = await source.read(path);
    const applied = applyEdits(current, edits);
    if (applied.problems.length > 0) return { ok: false, error: applied.problems.join('\n') };
    await source.write(path, applied.text);
    return { ok: true, text: applied.text, elements: (await this.open(path)).elements };
  }

  // --- the two ways in --------------------------------------------------------------------------

  /** Read from a folder the person picks; false if they did not. */
  async openFolder(): Promise<boolean> {
    const picked = await FolderSource.pick();
    if (!picked) return false;
    this.folderSource = picked;
    return true;
  }

  /** The path to open for a URL: the document at it, with what it refers to fetched relative to it. */
  openUrl(url: string): string {
    return new URL(url, location.href).href;
  }
}
