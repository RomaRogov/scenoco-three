/**
 * Duplicate and Delete — Unity's ⌘D and Delete: what a node's element wrote, changed in its file at
 * once, the page loaded again from it; a copy comes back selected.
 */
import type { EditHost } from '@scenoco-three/core';
import type { Object3D } from 'three';
import type { Model } from './Model.js';
import { call, where } from './server.js';

/** The element a duplicate made, selected once the page has loaded again. */
const SELECT_KEY = 'scenoco-editor-select';

/**
 * Duplicate or delete what a node's element wrote — Unity's Duplicate (⌘D) and Delete. The file
 * changes at once, unsaved changes saved first, and the page loads again from it, held as Reset
 * holds it: a copy comes back selected, in its original's place, to be moved.
 */
export async function restructure(model: Model, node: Object3D, duplicate: boolean): Promise<void> {
  const verb = duplicate ? 'duplicate' : 'delete';
  const view = await model.view(node);
  if (view.enter) return model.say(`This is part of the prefab <${view.enter.name}>: enter it to ${verb} what it is made of.`, true);
  const source = model.host.sourceOf(node);
  const address = source && !model.host.spawned(node) ? await model.files.addressFor(source) : null;
  const element = address && (await model.files.element(address));
  if (!address || !element) return model.say(`Nothing in a scene file wrote this node, so there is no element to ${verb}.`, true);
  if (!duplicate && !confirm(`Delete <${element.tag}> from ${where(source!).label}? The file changes now; undo does not bring it back.`)) return;
  if (model.unsavedCount) {
    await model.save();
    if (model.unsavedCount) return;
  }
  try {
    const done = await call<{ copy?: { line: number; column: number } }>('POST', verb, {
      file: address.file,
      index: address.index,
      expect: { tag: element.tag, line: element.line, column: element.column },
    });
    if (done.copy) remember(SELECT_KEY, { file: address.file, ...done.copy });
    model.host.reset(model.resetReach);
  } catch (error) {
    model.say(`Could not ${verb} <${element.tag}>: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

/** After a duplicate's reload: select the copy, once the scene has built it. */
export function selectRemembered(host: EditHost): void {
  const wanted = recall<{ file: string; line: number; column: number }>(SELECT_KEY);
  if (!wanted) return;
  remember(SELECT_KEY, null);
  const until = performance.now() + 3000;
  const look = () => {
    let found: Object3D | null = null;
    host.scene.traverse((n) => {
      const at = host.sourceOf(n);
      if (!found && at?.fileName === wanted.file && at.lineNumber === wanted.line && at.columnNumber === wanted.column) found = n;
    });
    if (found) host.select(found);
    else if (performance.now() < until) requestAnimationFrame(look);
  };
  look();
}

/** For this tab, across a reload. */
function remember(key: string, value: unknown): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // no storage: the copy is made, just not selected
  }
}

function recall<T>(key: string): T | null {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}
