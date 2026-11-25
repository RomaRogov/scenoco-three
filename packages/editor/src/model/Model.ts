/**
 * What the editor does, apart from how it looks: a node as the TSX that made it, with each value
 * live, and every change — to the live object at once, kept as unsaved until Save writes each one
 * as one attribute of the `.tsx` file it came from, spliced by the dev server with everything else
 * byte for byte.
 *
 * Only what a scene file wrote is written back: a node's own element, a prefab's tag, the behaviours
 * on them. What a prefab is made of, what was spawned and what code made is changed live only.
 *
 * `Model` is what the interface holds; the work is in its parts — `Reader` (view.ts) reads a node,
 * `History` (history.ts) keeps every change, `SceneFiles` (server.ts) asks the dev server.
 */
import type { EditHost, Reach, Transform } from '@scenoco-three/core';
import type { Object3D } from 'three';
import { History } from './history.js';
import { call, SceneFiles } from './server.js';
import { codeEditor, resetReach, setCodeEditor, setResetReach } from './settings.js';
import { restructure, selectRemembered } from './structure.js';
import type { Attr, CodeEditor, Stage, View, Where } from './types.js';
import { plainOf, shown } from './values.js';
import { Reader } from './view.js';
import { walk } from './tree.js';

export class Model {
  readonly host: EditHost;
  mode: 'translate' | 'rotate' | 'scale' = 'translate';
  status: { text: string; error: boolean } = { text: '', error: false };
  /** Called after something shown changed: the interface draws again. */
  changed: () => void = () => {};
  /** The scene files, as the dev server reads them. */
  readonly files: SceneFiles;
  /** What changed, unsaved, undone. */
  readonly history: History;
  private readonly reader: Reader;
  private quiet: ReturnType<typeof setTimeout> | undefined;

  constructor(host: EditHost) {
    this.host = host;
    this.files = new SceneFiles(() => this.changed(), (text, error) => this.say(text, error));
    this.history = new History(host, this.files, () => this.changed(), (text, error) => this.say(text, error));
    this.reader = new Reader(host, this.files, this.history, () => this.stage);
    selectRemembered(host);
  }

  /** The project's scenes, which the editor can open. */
  get scenes(): { file: string; name: string }[] {
    return this.files.scenes;
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  /** How many changes Save would write. */
  get unsavedCount(): number {
    return this.history.unsavedCount;
  }

  /** The node as its TSX: `Reader.view`. */
  view(node: Object3D): Promise<View> {
    return this.reader.view(node);
  }

  /** What a node's tag says: `Reader.tagName`. */
  tagName(node: Object3D): string {
    return this.reader.tagName(node);
  }

  /** A prefab's name: `Reader.prefabName`. */
  prefabName(root: Object3D): string {
    return this.reader.prefabName(root);
  }

  /** Set an attribute live, and — `done` — as a change: `History.set`. */
  set(attr: Attr, value: unknown, done: boolean, before: unknown = attr.value): Promise<void> {
    return this.history.set(attr, value, done, before);
  }

  /** Put an attribute back to what the file says: `History.reset`. */
  reset(attr: Attr): void {
    this.history.reset(attr);
  }

  /** Write what is unsaved: `History.save`. */
  save(): Promise<void> {
    return this.history.save();
  }

  /** Forget what is unsaved: `History.discard`. */
  discard(): void {
    this.history.discard();
  }

  undo(): void {
    this.history.undo();
  }

  redo(): void {
    this.history.redo();
  }

  /** Duplicate (true) or delete what a node's element wrote: see `structure.ts`. */
  restructure(node: Object3D, duplicate: boolean): Promise<void> {
    return restructure(this, node, duplicate);
  }

  /** The prefab being edited, entered from one of its copies: what prefab mode writes into. */
  stage: Stage | null = null;

  /** Only the copy being edited is shown. */
  isolated = false;

  /** Prefab mode: what `root` is made of becomes editable, written into the prefab's file, for every copy. */
  enter(root: Object3D): void {
    const own = this.host.own(root)?.source;
    const made = this.host.madeBy(root);
    if (!own || !made) return;
    let count = 0;
    walk(this.host, this.host.scene, (n) => void (this.host.madeBy(n)?.fn === made.fn && count++));
    this.stage = { root, name: this.prefabName(root), file: own.fileName, count };
    this.host.select(root);
    this.changed();
  }

  /** Back to the scene. */
  leave(): void {
    const root = this.stage?.root ?? null;
    this.stage = null;
    this.isolate(false);
    if (root) this.host.select(root);
    this.changed();
  }

  isolate(on: boolean): void {
    this.isolated = on && !!this.stage;
    this.host.isolate(this.isolated ? this.stage!.root : null);
    this.changed();
  }

  /** What the gizmo does: focusing position, rotation or scale picks it too. */
  setMode(mode: 'translate' | 'rotate' | 'scale'): void {
    this.mode = mode;
    this.host.setMode(mode);
  }

  /** The gizmo let go: write what it moved. */
  async moved(node: Object3D, before: Transform): Promise<void> {
    const name = ({ translate: 'position', rotate: 'rotation', scale: 'scale' } as const)[this.mode];
    const view = await this.view(node);
    const attr = view.tag.attrs.find((a) => a.name === name);
    if (attr?.kind) await this.set(attr, attr.value, true, shown(plainOf(this.host, before[name], name).value, attr.kind));
  }

  /** How source links open: this browser's choice, kept. */
  get codeEditor(): CodeEditor {
    return codeEditor();
  }

  set codeEditor(how: CodeEditor) {
    setCodeEditor(how);
    this.changed();
  }

  /** How far Reset lets behaviours go before it holds the scene: this browser's choice, kept. */
  get resetReach(): Reach {
    return resetReach();
  }

  set resetReach(reach: Reach) {
    setResetReach(reach);
    this.changed();
  }

  /** The command the project set for opening files, read once: null when it set none. */
  customCommand(): Promise<string | null> {
    return this.files.customCommand();
  }

  /** Open a place in the code editor the settings name. */
  async open(at: Where): Promise<void> {
    const how = this.codeEditor;
    if (how === 'vscode' || how === 'cursor') {
      // The editor's own URL: the browser hands it over, asking the first time.
      const link = document.createElement('a');
      link.href = `${how}://file${encodeURI(at.file)}:${at.line}:${at.col}`;
      link.click();
      return this.say(`Opening ${at.label} in ${how === 'vscode' ? 'VS Code' : 'Cursor'}…`);
    }
    try {
      await call('POST', 'open', { file: at.file, line: at.line, col: at.col, how });
      this.say(`Opened ${at.label}.`);
    } catch (error) {
      this.say(`Could not open ${at.label}: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  }

  /** A line under the toolbar: an error stays until the next, anything else goes after a moment. */
  say(text: string, error = false): void {
    this.status = { text, error };
    clearTimeout(this.quiet);
    if (text && !error) this.quiet = setTimeout(() => this.say(''), 3000);
    this.changed();
  }
}

export * from './types.js';
export { codeOf, kindOf, listItem } from './values.js';
