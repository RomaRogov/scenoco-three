import { Box3, BoxHelper, Raycaster, Vector2, Vector3, type Object3D } from 'three';
// Register every project component, package tag, and built-in node up front, so
// any scene/prefab the agent opens has its tags available.
import 'virtual:scenoco-components';
import { EditorSession } from './session.js';
import { connectEditor } from './wsClient.js';
import { CameraRig } from './cameraRig.js';
import { DesktopControls } from './desktopControls.js';
import { TouchControls, isTouchDevice } from './touchControls.js';
import { buildPanels, type Panels } from './panels.js';
import { SceneDocument } from './document.js';
import { Gizmo, type GizmoMode } from './gizmo.js';
import { buildToolbar, type Toolbar } from './toolbar.js';

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
      doc = new SceneDocument(graph);
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
  save: () => void doSave(),
  state: () => ({
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

async function doSave(): Promise<void> {
  if (!doc || saving || !doc.isDirty) return;
  saving = true;
  toolbar?.refresh();
  try {
    await session.save(doc.netEdits());
    doc.markSaved();
  } catch (e) {
    console.error('[editor] save failed:', e);
  } finally {
    saving = false;
    toolbar?.refresh();
  }
}

function onSelect(node: Object3D | null): void {
  if (selection) {
    session.engine.scene.remove(selection);
    selection.geometry.dispose();
    selection = undefined;
  }
  if (node) {
    selection = new BoxHelper(node, 0x4af0e0);
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
    if (gizmo?.contains(hit.object) || hit.object === selection) continue; // ignore gizmo / box helper
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

void (async () => {
  rebind(); // builds the (empty) panels
  connectEditor(session);
  const initial = new URLSearchParams(location.search).get('file');
  if (initial) {
    try {
      await session.open(initial);
    } catch (e) {
      console.error('[editor] open failed:', e);
    }
  }
  requestAnimationFrame(frame);
})();

function sceneCenter(): Vector3 {
  const box = new Box3().setFromObject(session.engine.scene);
  return box.isEmpty() ? new Vector3() : box.getCenter(new Vector3());
}
