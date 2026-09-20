/**
 * Where the page's documents come from: a folder on this machine, or a URL.
 *
 * There is no server. The page parses the document itself, builds the scene live, and saves by
 * writing the file back — into the folder it was opened from, with the compiler's own edit
 * splices applied to the text.
 */
import type { DocumentKindInfo, ProjectModel } from '@scenoco-three/compiler';
import { indexDocument, MODEL_FILE } from '@scenoco-three/compiler/browser';
import type { SceneType } from '@scenoco-three/core';
import { Scene } from 'three';
import type { Edit, RawElement } from './document.js';
import { buildLive, type Construct, type Registry, type Resolve } from './live/build.js';
import { Previews } from './live/preview.js';
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
  resolve: Resolve;
  /** Builds an object a person adds to a node, so it is there before the next rebuild. */
  construct?: Construct;
  /** The project's model when a build left one beside it; otherwise the tag packages' own. */
  model: ProjectModel;
  /** What draws this document's components, for the few that can be drawn. */
  previews?: Previews;
  /**
   * Set when this document is one a package declared — a `.particle.xml`.
   *
   * It is one typed value rather than a tree of nodes, so there is nothing to build and nothing
   * to pick: the stage stays empty and the form is the whole interface.
   */
  config?: DocumentKindInfo;
}

export type Saved = { ok: true; text: string; elements: RawElement[] } | { ok: false; error: string };

/** What a config document opens onto: nothing, because it describes no scene. */
class EmptyStage extends Scene {}

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

  /** The documents in the open folder that can be opened, then the examples the site carries. */
  async documents(): Promise<Pickable[]> {
    const own = this.folderSource ? await this.folderSource.list() : [];
    const openable = await this.openableKinds();
    const examples = await (this.bundled ??= fetch('./examples.json')
      .then((r) => (r.ok ? (r.json() as Promise<Pickable[]>) : []))
      .catch(() => [] as Pickable[]));
    return [
      ...own.filter((d) => openable.has(d.kind)).map((d) => ({ ...d, group: this.folderSource!.label })),
      ...examples,
    ];
  }

  /**
   * Which kinds are a thing to *open* — the rest are referenced by path from inside one.
   *
   * A scene and a prefab always are. Everything else is whatever the project's packages declared,
   * which is a question only the project's own model can answer, so it is read from the folder's
   * root before anything is opened.
   */
  private async openableKinds(): Promise<ReadonlySet<string>> {
    const model = this.folderSource
      ? ((await projectModelAt(this.folderSource, '')) ?? (await this.bundledModel()))
      : await this.bundledModel();
    return new Set(['scene', 'prefab', ...(model.documents ?? []).map((kind) => kind.kind)]);
  }

  /** The vocabulary this site was built with: three and every tag package it carries. */
  private bundledModel(): Promise<ProjectModel> {
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
    const project = await projectAt(source, path);
    const model = project?.model ?? (await this.bundledModel());

    // A kind a package declared is one value, not a tree of nodes: nothing to build, nothing to
    // pick. The stage stays empty and the form does the work.
    const config = (model.documents ?? []).find((kind) => path.endsWith(kind.extension));
    if (config) {
      this.opened = { path, source };
      return { path, text, elements, scene: EmptyStage, problems: [], resolve: async () => undefined, model, config };
    }

    // A preview is read relative to the document, because that is what this source understands:
    // the model was found by walking up from here, and the previews sit beside it.
    const previews = project ? new Previews(source, path, project.base, model.documents ?? []) : undefined;
    const live = await buildLive(path, source, model, await this.registry(), previews);
    this.opened = { path, source };
    const problems = project
      ? [...live.problems, ...(previews?.problems ?? [])]
      : [
          `No ${MODEL_FILE} at or above ${path} — only the tag packages' components are known. ` +
            'Run `scenoco build` in the project to read its own.',
          ...live.problems,
        ];
    return {
      path,
      text,
      elements,
      scene: live.SceneClass,
      problems,
      resolve: live.resolve,
      construct: live.construct,
      model,
      ...(previews ? { previews } : {}),
    };
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

/**
 * The model of the project a document belongs to: the nearest `.scenoco/model.json` at or above it.
 *
 * The page has no TypeScript checker, so it does not read a project's classes — the build did,
 * and left what it read beside the project. Nearest wins for the reason `scenoco` itself looks for
 * the nearest project root: a document belongs to the project that contains it.
 */
export async function projectModelAt(source: Source, path: string): Promise<ProjectModel | null> {
  return (await projectAt(source, path))?.model ?? null;
}

/**
 * The project a document belongs to: its model, and how to reach the rest of what the build left.
 *
 * `base` is what a root-relative build artifact hangs off — a preview module sits beside the model
 * it is named in, and the page has to turn ".scenoco/previews/Terrain.js" back into something this
 * source can read.
 */
export async function projectAt(
  source: Source,
  path: string,
): Promise<{ model: ProjectModel; base: string } | null> {
  const tried = new Set<string>();
  for (let up = ''; ; up += '../') {
    const candidate = source.resolve(path, `${up}${MODEL_FILE}`);
    // Past the top of a folder or a site, `..` resolves to the same place again.
    if (tried.has(candidate)) return null;
    tried.add(candidate);
    const model = await source.read(candidate).then(asModel, () => null);
    if (model) return { model, base: up };
  }
}

/** A model, or null for anything else a server answers with — a 404 page, an SPA fallback. */
function asModel(text: string): ProjectModel | null {
  try {
    const parsed = JSON.parse(text) as Partial<ProjectModel>;
    return Array.isArray(parsed.components) && Array.isArray(parsed.tags) ? (parsed as ProjectModel) : null;
  } catch {
    return null;
  }
}
