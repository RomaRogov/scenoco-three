import { Box3, BoxHelper, Raycaster, Vector2, Vector3, type Object3D } from 'three';
import { EditorSession } from './session.js';
import { connectEditor } from './wsClient.js';
import { CameraRig } from './cameraRig.js';
import { DesktopControls } from './desktopControls.js';
import { TouchControls, isTouchDevice } from './touchControls.js';
import { buildPanels, type Panels } from './panels.js';
import { SceneDocument } from './document.js';
import { Gizmo, type GizmoMode } from './gizmo.js';
import { buildToolbar, type Toolbar } from './toolbar.js';
import { showFilePicker } from './filePicker.js';
import { isEditorOnly } from './meta.js';
import type { AgentEdit } from '../src/protocol.js';

const canvas = document.getElementById('app') as HTMLCanvasElement;
// Right mouse drag is the fly-camera look control — suppress the native
// context menu it would otherwise pop on a real right-click.
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
const session = new EditorSession(canvas);

let rig: CameraRig | undefined;
let desktop: DesktopControls | undefined;
let panels: Panels | undefined;
let selection: BoxHelper | undefined;
let doc: SceneDocument | undefined;
let gizmo: Gizmo | undefined;
let gizmoMode: GizmoMode = 'translate';
let toolbar: Toolbar | undefined;
let saving = false;

// Rebuild the edit-mode camera, document, gizmo + refresh panels whenever the
// engine swaps (open / run / stop). Play mode runs the scene's own camera with
// no editor rig, document, or gizmo.
function rebind(): void {
  // A file is loaded (from the URL, a user pick, or an MCP `open`) — the start-up
  // picker, if still up, has served its purpose.
  if (session.filePath) document.querySelector('.sc-picker')?.remove();
  selection = undefined; // the old engine (and its scene helpers) is disposed
  rig = undefined;
  desktop = undefined;
  gizmo?.dispose();
  gizmo = undefined;
  doc = undefined;

  const graph = session.engine.getSceneGraph();
  if (session.mode === 'edit' && session.editorCamera) {
    rig = new CameraRig(session.editorCamera, sceneCenter());
    desktop = new DesktopControls(rig, session.engine.input);
    if (isTouchDevice()) new TouchControls(rig, canvas, () => gizmo?.dragging ?? false);
    if (graph) {
      doc = new SceneDocument(graph, session.provenance);
      doc.onChange(() => toolbar?.refresh()); // keep the dirty/undo state live
      gizmo = new Gizmo(session.editorCamera, canvas, session.engine.scene, isTouchDevice(), {
        onObjectChange: () => panels?.refresh(),
        onCommit: commitTransform,
      });
      gizmo.setMode(gizmoMode);
    }
  }
  if (!panels) panels = buildPanels(() => session.engine, () => doc, onSelect);
  else panels.refresh();
  if (!toolbar) toolbar = buildToolbar(toolbarHandlers);
  else toolbar.refresh();
}
session.onChange = rebind;

const toolbarHandlers = {
  play: () => {
    session.run();
    toolbar?.refresh();
  },
  pause: () => {
    session.pause();
    toolbar?.refresh();
  },
  step: () => {
    session.step();
    toolbar?.refresh();
  },
  stop: () => {
    session.stop();
    toolbar?.refresh();
  },
  getMode: () => gizmoMode,
  setMode: setGizmoMode,
  undo: () => {
    doc?.undoLast();
    panels?.refresh();
    toolbar?.refresh();
  },
  redo: () => {
    doc?.redoLast();
    panels?.refresh();
    toolbar?.refresh();
  },
  save: () => void doSave().catch(() => undefined), // failures surface in the save banner
  state: () => ({
    mode: session.mode,
    playing: session.playing,
    canUndo: doc?.canUndo ?? false,
    canRedo: doc?.canRedo ?? false,
    dirty: doc?.isDirty ?? false,
    saving,
    enabled: !!doc,
  }),
};

function setGizmoMode(mode: GizmoMode): void {
  gizmoMode = mode;
  gizmo?.setMode(mode);
  toolbar?.refresh();
}

async function doSave(): Promise<{ changed: number; unresolved: number }> {
  if (!doc || saving || !doc.isDirty) return { changed: 0, unresolved: 0 };
  saving = true;
  toolbar?.refresh();
  try {
    const result = await session.save(doc.netEdits());
    if (result.unresolved > 0) {
      // Some edits couldn't be located in the file (it changed on disk, or a
      // component type is unregistered) — keep the document dirty so nothing is
      // silently lost, and say so.
      setSaveError(`${result.unresolved} change(s) could not be written to the file — it may have changed on disk. Reload and re-apply, or fix the file.`);
    } else {
      doc.markSaved();
      setSaveError(undefined);
    }
    return result;
  } catch (e) {
    console.error('[editor] save failed:', e);
    setSaveError(e instanceof Error ? e.message : String(e));
    throw e;
  } finally {
    saving = false;
    toolbar?.refresh();
  }
}

// What MCP scene-mutating tools (edit_scene / save_file) run against: the same
// document funnel and save path as the human UI, so agent edits are undoable,
// dirty-flagging, and visible in the viewport.
const editorHost = {
  edit: (edits: AgentEdit[]) => {
    if (session.mode !== 'edit' || !doc) throw new Error('scene editing requires edit mode — stop playback first');
    const result = doc.applyAgentEdits(edits);
    panels?.refresh();
    toolbar?.refresh();
    return result;
  },
  save: () => {
    if (!doc) throw new Error('no file open');
    return doSave();
  },
};

/** Save-failure banner: unlike open/runtime errors this is transient — dismiss or a clean save clears it. */
let saveErrorBanner: HTMLElement | undefined;
function setSaveError(message: string | undefined): void {
  saveErrorBanner?.remove();
  saveErrorBanner = undefined;
  if (!message) return;
  const bar = document.createElement('div');
  bar.id = 'sc-save-error';
  bar.append(textSpan(`Save failed: ${message}`), bannerButton('Dismiss', () => setSaveError(undefined)));
  document.body.append(bar);
  saveErrorBanner = bar;
}

function onSelect(node: Object3D | null): void {
  if (selection) {
    session.engine.scene.remove(selection);
    selection.geometry.dispose();
    selection = undefined;
  }
  if (node) {
    selection = new BoxHelper(node, 0x4af0e0);
    selection.userData.scenocoEditorOnly = true; // keep out of the Hierarchy + picking
    session.engine.scene.add(selection);
    rig?.focusOn(node.getWorldPosition(new Vector3()));
  }
  gizmo?.attach(node);
}

/** Commit a gizmo drag as one undoable edit (only the channels that changed record). */
function commitTransform(object: Object3D): void {
  doc?.setTransform(object, 'position', object.position.toArray());
  doc?.setTransform(object, 'rotation', [object.rotation.x, object.rotation.y, object.rotation.z]);
  doc?.setTransform(object, 'scale', object.scale.toArray());
}

// ── viewport pick (tap/click an object to select it) ─────────────────────────────

const raycaster = new Raycaster();
let downX = 0;
let downY = 0;
let dragged = false;
canvas.addEventListener('pointerdown', (e) => {
  downX = e.clientX;
  downY = e.clientY;
  dragged = false;
});
canvas.addEventListener('pointermove', (e) => {
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) dragged = true;
});
canvas.addEventListener('pointerup', (e) => {
  if (dragged || gizmo?.dragging || session.mode !== 'edit') return; // a camera/gizmo gesture, not a pick
  panels?.select(pickAt(e.clientX, e.clientY));
});

function pickAt(clientX: number, clientY: number): Object3D | null {
  const cam = session.editorCamera;
  if (!cam) return null;
  const rect = canvas.getBoundingClientRect();
  const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, cam);
  for (const hit of raycaster.intersectObjects(session.engine.scene.children, true)) {
    if (isEditorOnly(hit.object)) continue; // ignore gizmo handles / box helper / preview lights
    return selectable(hit.object);
  }
  return null;
}

/** Walk up to the nearest id'd ancestor (the editable node); else the hit object. */
function selectable(object: Object3D): Object3D {
  for (let o: Object3D | null = object; o && o !== session.engine.scene; o = o.parent) {
    if (o.name) return o;
  }
  return object;
}

// ── gizmo mode keys (W/A/S/D/Q/E drive the fly camera; use G/R/Y) ──────────────────

window.addEventListener('keydown', (e) => {
  if (isTextField(e.target)) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) toolbarHandlers.redo();
    else toolbarHandlers.undo();
    return;
  }
  if (!gizmo) return;
  const mode = ({ g: 'translate', r: 'rotate', y: 'scale' } as const)[e.key.toLowerCase()];
  if (mode) setGizmoMode(mode);
});
function isTextField(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
}

// ── external file changes (watcher) ──────────────────────────────────────────────

let reloading = false;
let conflictBanner: HTMLElement | undefined;

session.onExternalChange = (_file, role) => void handleExternalChange(role);
// A gameplay frame that throws surfaces in the same banner; playback is already
// paused by the session, so the editor stays alive until the code is fixed.
session.onRuntimeError = (message) => setComponentError(message);

async function handleExternalChange(role: 'open' | 'dep'): Promise<void> {
  if (reloading) return;
  if (role === 'dep') {
    await reloadScene(true); // a prefab/material changed — refresh now, preserving unsaved edits
  } else if (!(doc?.isDirty ?? false)) {
    await reloadScene(false); // the open file changed externally with nothing unsaved — just sync
  } else {
    showConflict(); // unsaved edits vs. an external change — let the user decide
  }
}

async function reloadScene(preserveEdits: boolean): Promise<void> {
  const path = session.filePath;
  if (!path) return;
  reloading = true;
  const pending = preserveEdits ? (doc?.netEdits() ?? []) : [];
  try {
    const summary = await session.open(path); // re-fetch + swap → rebind() builds a fresh document
    if (pending.length) doc?.applyEdits(pending);
    setComponentError(summary.componentError); // clears when a fix takes effect
  } catch (e) {
    console.error('[editor] reload failed:', e);
    setComponentError(e instanceof Error ? e.message : String(e));
  } finally {
    reloading = false;
    dismissConflict();
    panels?.refresh();
    toolbar?.refresh();
  }
}

function showConflict(): void {
  if (conflictBanner) return;
  const bar = document.createElement('div');
  bar.id = 'sc-conflict';
  bar.append(textSpan('Conflicting changes were made in the original file.'));
  bar.append(bannerButton('Reload', () => void reloadScene(false)), bannerButton('Keep editing', dismissConflict));
  document.body.append(bar);
  conflictBanner = bar;
}
function dismissConflict(): void {
  conflictBanner?.remove();
  conflictBanner = undefined;
}

// A persistent error banner for a broken component set. The editor page stays
// alive (MCP too) but can't render until the code compiles again; this says why
// and reloads automatically on fix. Passing `undefined` clears it.
let errorBanner: HTMLElement | undefined;
function setComponentError(message: string | undefined): void {
  if (!message) {
    errorBanner?.remove();
    errorBanner = undefined;
    return;
  }
  const text = `Component code has an error — the editor will reload once it's fixed:\n${message}`;
  if (errorBanner) {
    (errorBanner.firstChild as HTMLElement).textContent = text;
    return;
  }
  const bar = document.createElement('div');
  bar.id = 'sc-error';
  bar.append(textSpan(text), bannerButton('Dismiss', () => setComponentError(undefined)));
  document.body.append(bar);
  errorBanner = bar;
}
function textSpan(text: string): HTMLElement {
  const s = document.createElement('span');
  s.textContent = text;
  return s;
}
function bannerButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  session.tick(dt);
  if (!gizmo?.dragging) desktop?.update(dt); // let the gizmo own the pointer while dragging
  rig?.sync();
  selection?.update();
  requestAnimationFrame(frame);
}

/** Open a file and reflect it in the URL, so reloads and the wi-fi link resume it. */
async function openFile(path: string): Promise<void> {
  try {
    const summary = await session.open(path);
    const url = new URL(location.href);
    url.searchParams.set('file', path);
    history.replaceState(null, '', url);
    setComponentError(summary.componentError);
  } catch (e) {
    console.error('[editor] open failed:', e);
    setComponentError(e instanceof Error ? e.message : String(e));
  }
}

void (async () => {
  // Core tags + tag packages first, as their own import — this is the registry
  // every core scene decodes against, so it must NOT depend on project components
  // loading (a broken component previously cascaded into "Background not registered").
  try {
    await import('virtual:scenoco-runtime');
  } catch (e) {
    console.error('[editor] runtime tags failed to load:', e);
    setComponentError(e instanceof Error ? e.message : String(e));
  }
  // Project components, imported separately + caught so a broken component file
  // can't abort page startup or wipe the core tags above: the WS bridge (hence
  // MCP) and the error banner still come up, and core scenes still preview. A full
  // reload on the next successful HMR update revives components once they're fixed.
  try {
    await import('virtual:scenoco-components');
  } catch (e) {
    console.error('[editor] components failed to load:', e);
    setComponentError(e instanceof Error ? e.message : String(e));
    if (import.meta.hot) import.meta.hot.on('vite:afterUpdate', () => location.reload());
  }
  rebind(); // builds the (empty) panels
  connectEditor(session, editorHost);
  const initial = new URLSearchParams(location.search).get('file');
  if (initial) await openFile(initial);
  else void showFilePicker(openFile); // no ?file= → let the user pick from assets/
  requestAnimationFrame(frame);
})();

function sceneCenter(): Vector3 {
  const box = new Box3().setFromObject(session.engine.scene);
  return box.isEmpty() ? new Vector3() : box.getCenter(new Vector3());
}
