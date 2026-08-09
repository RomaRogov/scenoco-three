import {
  Box3, BoxHelper, IcosahedronGeometry, LineBasicMaterial, LineSegments, Raycaster, Vector2, Vector3,
  WireframeGeometry, type Object3D,
} from 'three';
import { EditorSession, resolveInEngine } from './session.js';
import { connectEditor } from './wsClient.js';
import { CameraRig } from './cameraRig.js';
import { DesktopControls } from './desktopControls.js';
import { TouchControls, isTouchDevice } from './touchControls.js';
import { mountEditorUI } from './ui/mount.js';
import type { EditorUIHandle } from './ui/types.js';
import { SceneDocument } from './document.js';
import { Gizmo, type GizmoMode } from './gizmo.js';
import { showFilePicker } from './filePicker.js';
import { isEditorOnly } from './meta.js';
import type { CompiledScene } from '@scenoco-three/core';
import type { NodeRef } from '../src/protocol.js';

const canvas = document.getElementById('app') as HTMLCanvasElement;
// Right mouse drag is the fly-camera look control — suppress the native
// context menu it would otherwise pop on a real right-click.
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
const session = new EditorSession(canvas);

let rig: CameraRig | undefined;
let desktop: DesktopControls | undefined;
let ui: EditorUIHandle | undefined;
/** BoxHelper's own shape — the marker fallback below matches it structurally. */
interface SelectionHelper extends LineSegments {
  update(): void;
}
let selection: SelectionHelper | undefined;
let doc: SceneDocument | undefined;
let gizmo: Gizmo | undefined;
let gizmoMode: GizmoMode = 'translate';
let saving = false;
/** The current selection (tracked here so tree-edit actions/keys can target it). */
let selectedNode: Object3D | null = null;
/** Cut/copy clipboard — an in-memory compiled subtree fragment, pasted with no recompile. */
let clipboard: CompiledScene | null = null;

// Edits fire the document's change event per-commit (including each coalesced
// scrub tick); collapse a burst into one UI refresh per frame so the React tree/
// inspector/top-bar re-render at most once a frame.
let refreshQueued = false;
function scheduleRefresh(): void {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    ui?.refresh();
  });
}

// Rebuild the edit-mode camera, document, gizmo + refresh the UI whenever the
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
      doc = new SceneDocument(graph, session.provenance, session.engine);
      // Keep the session's play/preview overlays (attribute + structural) in sync with
      // the doc, then refresh the UI — so Play reflects edits even before a save.
      doc.onChange(() => {
        session.setEdits(doc?.netEdits() ?? []);
        session.setStructural(doc?.structuralOps() ?? []);
        scheduleRefresh();
      });
      // Restore edits that outlived an engine swap (e.g. play→stop, which rebuilds the
      // edit engine from the saved baseline), re-recording them in the fresh document so
      // they stay dirty + saveable. Snapshot first: applyEdits fires onChange, which
      // resets the session overlays. Runs for UI + MCP stops; a no-op on a fresh open.
      const pendingEdits = session.pendingEdits;
      const pendingStructural = session.pendingStructural;
      if (pendingEdits.length) doc.applyEdits(pendingEdits);
      // Re-record the structural op-log against the fresh document so reparents /
      // deletes / pastes survive an engine swap (play→stop) — each replays through the
      // same live path (add / removeFromParent / spawnSubtree), in original order.
      const resolveParent = (ref: NodeRef): Object3D | undefined =>
        ref.path?.length === 0 ? session.engine.scene : resolveInEngine(session.engine, ref);
      for (const op of pendingStructural) {
        if (op.op === 'moveNode') {
          const node = resolveInEngine(session.engine, op.target);
          const parent = resolveParent(op.parent);
          if (node && parent) doc.moveNode(node, parent, op.index);
        } else if (op.op === 'removeNode') {
          const node = resolveInEngine(session.engine, op.target);
          if (node) doc.removeNode(node);
        } else if (op.op === 'insertNode') {
          const parent = resolveParent(op.parent);
          if (parent) doc.pasteFragment(op.fragment, parent, op.index);
        }
      }
      gizmo = new Gizmo(session.editorCamera, canvas, session.engine.scene, isTouchDevice(), {
        onObjectChange: () => ui?.refresh(),
        onCommit: commitTransform,
      });
      gizmo.setMode(gizmoMode);
    }
  }
  if (!ui)
    ui = mountEditorUI({
      getEngine: () => session.engine,
      getDoc: () => doc,
      handlers: toolbarHandlers,
      onSelect,
      focusSelected: frameNode,
      reparent: (node, newParent, index) => {
        doc?.moveNode(node, newParent, index);
        ui?.refresh();
      },
      copy: copyNode,
      cut: cutNode,
      paste: pasteInto,
      remove: deleteNode,
      setId: (node, id) => {
        doc?.setId(node, id);
        ui?.refresh();
      },
      hasClipboard: () => clipboard !== null,
    });
  else ui.refresh();
}
session.onChange = rebind;

const toolbarHandlers = {
  play: () => {
    session.run();
    ui?.refresh();
  },
  pause: () => {
    session.pause();
    ui?.refresh();
  },
  step: () => {
    session.step();
    ui?.refresh();
  },
  stop: () => {
    session.stop();
    ui?.refresh();
  },
  getMode: () => gizmoMode,
  setMode: setGizmoMode,
  undo: () => {
    doc?.undoLast();
    ui?.refresh();
  },
  redo: () => {
    doc?.redoLast();
    ui?.refresh();
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
  ui?.refresh();
}

async function doSave(): Promise<{ changed: number; unresolved: number }> {
  if (!doc || saving || !doc.isDirty) return { changed: 0, unresolved: 0 };
  saving = true;
  ui?.refresh();
  try {
    const result = await session.save(doc.netEdits(), doc.structuralOps());
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
    ui?.refresh();
  }
}

// ── tree edits: copy / cut / paste / delete / rename (all through the document) ─────

/** Copy `node`'s subtree into the clipboard as a compiled fragment (ids stripped). */
function copyNode(node: Object3D): void {
  const fragment = doc?.copyFragment(node);
  if (fragment) clipboard = fragment;
  ui?.refresh(); // reflect the new clipboard in Paste's enabled state
}
/** Delete `node`; clears the selection if it (or an ancestor) was selected. */
function deleteNode(node: Object3D): void {
  if (!doc) return;
  doc.removeNode(node);
  if (selectedNode && !inScene(selectedNode)) ui?.select(null);
  else ui?.refresh();
}
/** Cut = copy then delete. */
function cutNode(node: Object3D): void {
  copyNode(node);
  deleteNode(node);
}
/** Paste the clipboard fragment under `parent` (or the scene root) and select it. */
function pasteInto(parent: Object3D | null): void {
  if (!doc || !clipboard) return;
  const root = doc.pasteFragment(clipboard, parent ?? session.engine.scene);
  if (root) ui?.select(root);
  else ui?.refresh();
}
/** Whether `object` is still attached under the live scene (false once deleted). */
function inScene(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (o === session.engine.scene) return true;
  return false;
}

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

const SELECTION_COLOR = 0x4af0e0;

function onSelect(node: Object3D | null): void {
  selectedNode = node;
  if (selection) {
    session.engine.scene.remove(selection);
    selection.geometry.dispose();
    selection = undefined;
  }
  if (node) {
    // A node whose subtree has no `Object3D.geometry` vertex data (an empty
    // Box3) gets no outline from BoxHelper — not just Camera/Light, but any
    // `@scenoco-three/ui` element: uikit renders panels/text through its own
    // batched draw pipeline and never populates `mesh.geometry`, so a selected
    // HUD node would otherwise show *no* selection feedback at all. Fall back to
    // a small marker at the node's world transform, like an engine's icon gizmo
    // for a non-visual object.
    const bounds = new Box3().setFromObject(node);
    selection = bounds.isEmpty() ? markerHelper(node, SELECTION_COLOR) : new BoxHelper(node, SELECTION_COLOR);
    selection.userData.scenocoEditorOnly = true; // keep out of the Hierarchy + picking
    session.engine.scene.add(selection);
    // No auto-focus on select — selecting only highlights; the node-list "focus"
    // action (frameNode) is the explicit way to recenter the camera.
  }
  gizmo?.attach(node);
}

/** Reframe the camera on a node's subtree bounds — the node-list "focus" action. */
function frameNode(node: Object3D): void {
  const bounds = new Box3().setFromObject(node);
  const center = bounds.isEmpty() ? node.getWorldPosition(new Vector3()) : bounds.getCenter(new Vector3());
  rig?.lookAt(center);
}

/**
 * A small wireframe marker tracking `node`'s world transform — `BoxHelper`'s
 * counterpart for a node with no visible geometry anywhere in its subtree
 * (Camera, Light, or any `@scenoco-three/ui` element: uikit renders panels/
 * text through its own batched draw pipeline and never populates
 * `mesh.geometry`, so `Box3.setFromObject` comes back empty). `depthTest:
 * false` keeps it visible even when — as a UI element commonly is — it sits
 * right at or inside other geometry.
 */
function markerHelper(node: Object3D, color: number): SelectionHelper {
  // A faceted sphere (not the move gizmo's own arrow/cube shapes) so it reads as
  // a distinct "selection halo" rather than blending into the transform gizmo,
  // which is drawn at the same point. `depthTest: false` keeps it visible
  // through — or up against — any geometry it sits inside.
  const marker = new LineSegments(
    new WireframeGeometry(new IcosahedronGeometry(0.4, 1)),
    new LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.8 }),
  ) as unknown as SelectionHelper;
  marker.update = () => {
    node.getWorldPosition(marker.position);
    node.getWorldQuaternion(marker.quaternion);
  };
  marker.update();
  return marker;
}

/** Commit a gizmo drag as one undoable edit (only the channels that changed record). */
function commitTransform(object: Object3D): void {
  doc?.setTransform(object, 'position', object.position.toArray());
  doc?.setTransform(object, 'eulerAngles', object.eulerAngles.toArray());
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
  ui?.select(pickAt(e.clientX, e.clientY));
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
    if (o.sceneId) return o;
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
  // Tree edits on the current selection (edit mode only) — copy/cut/paste + delete.
  if (session.mode === 'edit') {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
      const k = e.key.toLowerCase();
      if (k === 'c' && selectedNode) return void (e.preventDefault(), copyNode(selectedNode));
      if (k === 'x' && selectedNode) return void (e.preventDefault(), cutNode(selectedNode));
      if (k === 'v' && clipboard) return void (e.preventDefault(), pasteInto(selectedNode));
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNode) return void (e.preventDefault(), deleteNode(selectedNode));
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
let componentsBanner: HTMLElement | undefined;

session.onExternalChange = (_file, role) => void handleExternalChange(role);
session.onComponentsChanged = (metaChanged) => handleComponentsChanged(metaChanged);
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

/**
 * A project component file changed. The component classes are ES modules already
 * evaluated in this page, so new `@property` metadata only reaches the inspector
 * after a full page reload — which throws away unsaved scene edits. Reload
 * silently when there is nothing to lose; otherwise let the user choose.
 */
function handleComponentsChanged(metaChanged: boolean): void {
  if (reloading) return;
  if (!(doc?.isDirty ?? false)) {
    location.reload();
    return;
  }
  showComponentsConflict(metaChanged);
}

/**
 * Unsaved edits vs. changed component code. "Save and reload" writes the scene
 * first and only reloads if the write fully succeeded — a partial save (some edits
 * unresolved) keeps the page alive so nothing is lost silently.
 */
function showComponentsConflict(metaChanged: boolean): void {
  if (componentsBanner) return;
  const bar = document.createElement('div');
  bar.id = 'sc-conflict';
  bar.append(
    textSpan(
      metaChanged
        ? 'Component properties changed on disk. Reloading is needed to show them — you have unsaved scene changes.'
        : 'Component code changed on disk. Reloading is needed to run it — you have unsaved scene changes.',
    ),
  );
  bar.append(
    bannerButton('Save and reload', () => {
      void (async () => {
        const result = await doSave();
        if (result.unresolved > 0) return; // doSave already explained; stay put
        location.reload();
      })();
    }),
    bannerButton('Reload (lose changes)', () => location.reload()),
    bannerButton('Keep editing', dismissComponentsConflict),
  );
  document.body.append(bar);
  componentsBanner = bar;
}
function dismissComponentsConflict(): void {
  componentsBanner?.remove();
  componentsBanner = undefined;
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
    ui?.refresh();
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
/**
 * Show this editor's LAN URL in a corner badge so you can open the same scene on
 * another device on the network (phone/tablet). The server resolves the address
 * (`/@scenoco/info`); we append the current `?file=` so the device lands on the
 * same file. Hidden when there's no LAN address, or when this page is already the
 * network URL (you're on the device). Click copies it to the clipboard.
 */
async function showNetworkUrl(): Promise<void> {
  let networkUrl: string | null;
  try {
    ({ networkUrl } = (await (await fetch('/@scenoco/info')).json()) as { networkUrl: string | null });
  } catch {
    return; // info endpoint unreachable — no badge, non-fatal
  }
  if (!networkUrl) return;
  const target = networkUrl.replace(/\/$/, '') + location.search; // carry the open ?file= to the device
  if (new URL(networkUrl).host === location.host) return; // already viewing via the LAN URL

  const bar = document.createElement('div');
  bar.id = 'sc-net';
  bar.title = 'Open this scene on another device — click to copy';
  const label = textSpan('LAN ');
  label.className = 'sc-net-label';
  const link = textSpan(target.replace(/^https?:\/\//, ''));
  bar.append(label, link);
  bar.onclick = () => {
    void navigator.clipboard?.writeText(target).catch(() => {});
    const prev = link.textContent;
    link.textContent = 'copied';
    setTimeout(() => (link.textContent = prev), 1200);
  };
  document.body.append(bar);
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
  rebind(); // mounts the editor UI (empty until a file loads)
  connectEditor(session);
  void showNetworkUrl(); // corner badge with the LAN URL for opening on another device
  const initial = new URLSearchParams(location.search).get('file');
  if (initial) await openFile(initial);
  else void showFilePicker(openFile); // no ?file= → let the user pick from assets/
  requestAnimationFrame(frame);
})();

function sceneCenter(): Vector3 {
  const box = new Box3().setFromObject(session.engine.scene);
  return box.isEmpty() ? new Vector3() : box.getCenter(new Vector3());
}
