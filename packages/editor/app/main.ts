import type { Object3D, Vector3 } from 'three';
import type { ProjectModel } from '@scenoco-three/compiler';
import { CameraRig } from './cameraRig.js';
import { DesktopControls } from './desktopControls.js';
import { TouchControls, isTouchDevice } from './touchControls.js';
import { SceneDocument, type RawElement } from './document.js';
import { Gizmo, type GizmoSpace } from './gizmo.js';
import { pickAt } from './picking.js';
import { EditorSession, type FocusTarget } from './session.js';
import { mountEditorUI } from './ui-react/mount.js';
import type { EditorUIHandle } from './ui-react/types.js';
import {
  WS_PATH,
  type EditorCommand,
  type EditorPush,
  type EditorResponse,
  type EditorResult,
} from '../src/protocol.js';

/**
 * The editor page.
 *
 * It holds one live scene — the project's own generated module, not a preview build of it — and
 * three things that act on it: a viewport that flies around and picks, a document that turns a
 * pick into the element that made it, and a bridge that lets an agent look at the same scene the
 * person is looking at.
 */
const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;
const session = new EditorSession(canvas);
session.onChange = () => onSceneReplaced();
const rig = new CameraRig(session.editorCamera, session.editorCamera.position.clone().setLength(0));
const controls = new DesktopControls(rig);
// Both, always: a laptop with a touchscreen is one device with two ways to drive the camera, and
// they never conflict because each only calls rig verbs. `isTouchDevice` decides handle *size*,
// which is a question about fingers rather than about which listeners to attach.
//
// Unlike the desktop controls it needs no per-frame update — touch is event-driven, so this
// binding exists to own its listeners for as long as the page does.
const touchControls = new TouchControls(rig, canvas, () => gizmo?.dragging ?? false);

let model: ProjectModel | null = null;
let doc: SceneDocument | null = null;
let selected: Object3D | null = null;
let gizmo: Gizmo | null = null;
let ui: EditorUIHandle | null = null;
/** A cut/copied subtree, as the XML that produced it. */
let clipboard: string | null = null;
/** Kept here rather than on the gizmo, which is rebuilt with every scene. */
let gizmoSpace: GizmoSpace = 'world';
let status = '';

// --- loading ---------------------------------------------------------------------------------

async function documents(): Promise<Array<{ kind: string; path: string; stem: string }>> {
  return (await fetch('/@scenoco/documents').then((r) => r.json())) as Array<{
    kind: string;
    path: string;
    stem: string;
  }>;
}

async function open(path: string): Promise<void> {
  // A refusal says why — the open dialog shows it, rather than the page half-loading a document
  // the server never sent.
  const response = await fetch(`/@scenoco/document?path=${encodeURIComponent(path)}`);
  const body = (await response.json()) as
    | { path: string; module: string; text: string; elements: RawElement[] }
    | { error: string };
  if ('error' in body) throw new Error(`${path}: ${body.error}`);
  const info = body;
  model ??= (await fetch('/@scenoco/model').then((r) => r.json())) as ProjectModel;

  // Cache-busted: the module was just rebuilt, and a browser that reuses the old one shows the
  // previous scene while the inspector shows the new document.
  const reopening = doc?.path === info.path;
  await session.open(`${info.module}?v=${Date.now()}`);

  // Framing is for arriving at a document, not for returning to one. A rebuild after a save —
  // or after someone else touched a file — should leave the camera exactly where the person
  // parked it; throwing them back to the establishing shot every time is what makes an
  // otherwise invisible reload feel like the editor lost its place. A page reload counts as
  // returning too: the dev server reloads the page whenever project code changes, and coming
  // back to a different view every time reads as the editor losing its place.
  if (reopening || restoreView(info.path)) {
    // keep the view
  } else {
    frame_(session.frameAll());
  }
  doc = new SceneDocument(info.path, info.text, info.elements, model);
  doc.onChange(() => ui?.refresh());
  history.replaceState(null, '', `?path=${encodeURIComponent(path)}`);
  ui?.refresh(); // a document is open now — the open dialog stands down, the toolbar wakes up
}

/**
 * The session replaced the live scene — on open, and on every Stop, which rebuilds it.
 *
 * Everything the editor holds that points *into* a scene has to be rebuilt with it. The gizmo's
 * helper is a child of the scene it was made for, so after a Stop it sits in the discarded one
 * and the handles simply stop appearing; the selection points at a node that no longer exists in
 * any scene. Neither is recoverable by clicking around — the editor looks broken until reload.
 */
function onSceneReplaced(): void {
  select(null);
  attachGizmo();
  ui?.refresh();
}

function attachGizmo(): void {
  gizmo?.dispose();
  if (!session.scene) return;
  gizmo = new Gizmo(session.editorCamera, canvas, session.scene, isTouchDevice(), {
    onObjectChange: () => {
      // Live while dragging, written to the document once — one drag is one undo step and one
      // line in the diff.
      if (!selected || !doc) return;
      const channel = gizmo!.mode === 'rotate' ? 'eulerAngles' : gizmo!.mode === 'scale' ? 'scale' : 'position';
      doc.setTransform(selected, channel, { coalesce: true, from: gizmo!.grabbedValue(channel) });
    },
  });

  gizmo.setSpace(gizmoSpace);

  // Move the pick behind three's own pointerdown handler. `TransformControls` installs its
  // listener in the constructor above, so re-adding ours now puts it last, and `gizmo.dragging`
  // is already true by the time `pick` asks. Order is the whole mechanism: registered first, the
  // pick sees `dragging === false` on every press, and a grab of a handle reads as a click on
  // empty space.
  canvas.removeEventListener('pointerdown', pick);
  canvas.addEventListener('pointerdown', pick);
}

// --- selection -------------------------------------------------------------------------------

/**
 * Pick whatever is under the pointer.
 *
 * A press that lands on a gizmo handle is not a pick at all — it is the start of a drag, and the
 * `dragging` test is what tells the two apart. That test only works because this listener runs
 * *after* the one `TransformControls` installs, which is why `attachGizmo` re-registers it (see
 * there); a press on a handle would otherwise deselect the very object being dragged and detach
 * the gizmo out from under three's own pointerdown handler.
 */
function pick(event: PointerEvent): void {
  if (event.button !== 0 || !session.scene || gizmo?.dragging) return;
  select(pickAt(event, canvas, session.scene, session.renderCamera()));
}

canvas.addEventListener('pointerdown', pick);

/**
 * Selection travels in two directions, and they must not be the same function.
 *
 * The chrome's store calls the host when *it* selects something; the host calls the store when a
 * viewport pick does. Wiring both to one entry point made each call the other for ever — a stack
 * overflow before the first frame.
 */
function applySelection(node: Object3D | null): void {
  selected = node;
  gizmo?.attach(node && doc?.canEditTransform(node) ? node : null);
}

/**
 * Fly the rig to what the session just measured.
 *
 * Two steps because they have two owners: the session measures the subject, the rig owns the
 * camera. Writing the camera transform anywhere else is undone by the next `sync()`.
 */
function frame_(target: FocusTarget | null): void {
  if (target) rig.frameOn(target.center, target.distance);
}

/**
 * Whether a file that changed on disk can change what the open document *is*.
 *
 * The server watches the whole project and says what moved; every change used to reload the
 * scene, so editing an unrelated level, or any tool touching any file, threw away the camera and
 * the selection for nothing. A sibling scene cannot affect this one — everything else can: a
 * `.ts` changes what a component does, and every other kind of document is something a scene
 * references by path.
 */
function affectsOpenDocument(changed: string, open: string): boolean {
  if (changed === open) return true;
  return !changed.endsWith('.scene.xml');
}

// --- keeping the view across a reload ---------------------------------------------------------

/**
 * Where the camera was, per document, so a reload puts it back.
 *
 * `sessionStorage` because it belongs to this tab and this sitting: another tab on another
 * document has its own, and none of it should outlive the browser session.
 */
const VIEW_KEY = 'scenoco:view';

/** Put the camera back where this document was last looked at. True when there was one. */
function restoreView(path: string): boolean {
  try {
    const saved = JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? 'null') as {
      path: string;
      position: [number, number, number];
      yaw: number;
      pitch: number;
    } | null;
    if (!saved || saved.path !== path) return false;
    session.editorCamera.position.set(...saved.position);
    rig.euler.y = saved.yaw;
    rig.euler.x = saved.pitch;
    rig.sync();
    return true;
  } catch {
    return false; // a malformed entry is not worth a broken boot
  }
}

// The frame loop stops when a tab is hidden, which is the moment before a reload is most likely
// — a phone backgrounding the browser, then the dev server reloading the page on reconnect. These
// two fire when rAF does not, so the last thing saved is the view as it actually was.
window.addEventListener('visibilitychange', saveView);
window.addEventListener('pagehide', saveView);

/** Remember the current view. Called from the frame loop, at most once a second. */
function saveView(): void {
  if (!doc) return;
  const { x, y, z } = session.editorCamera.position;
  try {
    sessionStorage.setItem(
      VIEW_KEY,
      JSON.stringify({ path: doc.path, position: [x, y, z], yaw: rig.euler.y, pitch: rig.euler.x }),
    );
  } catch {
    /* storage full or blocked — the view is a convenience, never a requirement */
  }
}

/** A pick in the viewport: move the gizmo, and tell the chrome. */
function select(node: Object3D | null): void {
  applySelection(node);
  ui?.select(node);
}

// --- keyboard --------------------------------------------------------------------------------

/**
 * The shortcuts the top bar already promises.
 *
 * Its buttons are labelled `Move (G)`, `Rotate (R)`, `Scale (Y)`, so the keys are part of the
 * interface whether or not anything listens for them — a label that lies is worse than no label.
 *
 * Nothing fires while a field has focus: the inspector is full of text inputs, and typing `y`
 * into an id should spell a `y`, not reach past the caret and switch the gizmo.
 */
window.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return;

  const accel = event.metaKey || event.ctrlKey;
  if (accel) {
    const key = event.key.toLowerCase();
    if (key === 's') doNow(event, () => void save());
    else if (key === 'z') doNow(event, () => (event.shiftKey ? doc?.redoLast() : doc?.undoLast()));
    return;
  }
  if (event.altKey) return;

  switch (event.key.toLowerCase()) {
    case 'g':
      return doNow(event, () => gizmo?.setMode('translate'));
    case 'r':
      return doNow(event, () => gizmo?.setMode('rotate'));
    case 'y':
      return doNow(event, () => gizmo?.setMode('scale'));
    // Frame the selection, or the whole scene when there is none — the same key does both in
    // every editor that has one.
    case 'f':
      return doNow(event, () => frame_(selected ? session.frameNode(selected) : session.frameAll()));
    default:
  }
});

/** Run a shortcut and repaint the chrome, so a mode button lights up the way a click would. */
function doNow(event: KeyboardEvent, run: () => void): void {
  event.preventDefault();
  run();
  ui?.refresh();
}

// --- saving ----------------------------------------------------------------------------------

async function save(): Promise<void> {
  if (!doc || !doc.isDirty) return;
  const response = await fetch('/@scenoco/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: doc.path, edits: doc.edits() }),
  });
  const body = (await response.json()) as { text?: string; elements?: RawElement[]; error?: string };
  if (!response.ok) {
    // The document is untouched on disk when a save is refused, so the edits stay pending and
    // the next attempt can succeed — nothing is lost by showing the reason and stopping.
    report(body.error ?? 'save failed');
    return;
  }
  doc.markSaved(body.text!, body.elements ?? []);
  report('saved');
}

// --- the bridge ------------------------------------------------------------------------------

/**
 * Serve the observation commands.
 *
 * There is no edit command and there will not be one: an agent has file tools, and a second
 * write path into someone's source is a write their editor, diff and undo never saw.
 */
function connect(): void {
  const socket = new WebSocket(`ws://${location.host}${WS_PATH}`);
  socket.addEventListener('message', async (event) => {
    const message = JSON.parse(String(event.data)) as EditorCommand | EditorPush;
    if ('push' in message) {
      if (message.push === 'shutdown') window.close();
      else if (message.push === 'buildFailed') report(message.message);
      else if (doc && affectsOpenDocument(message.file, doc.path)) await open(doc.path);
      return;
    }
    const reply = (response: EditorResponse): void => socket.send(JSON.stringify(response));
    try {
      reply({ id: message.id, ok: true, result: await run(message) });
    } catch (error) {
      reply({ id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
  socket.addEventListener('close', () => setTimeout(connect, 1000));
}

async function run(command: EditorCommand): Promise<EditorResult> {
  switch (command.type) {
    case 'open':
      await open(command.path);
      return { kind: 'ok', info: command.path };
    case 'run':
      session.run();
      return { kind: 'ok' };
    case 'pause':
      session.pause();
      return { kind: 'ok' };
    case 'stop':
      await session.stop();
      return { kind: 'ok' };
    case 'preview':
      return { kind: 'image', dataUrl: session.preview(command.frame, command.camera, command.lookAt) };
    case 'telemetry':
      return { kind: 'json', data: session.telemetry(command.targetId) };
    case 'simulate':
      return {
        kind: 'multi',
        results: (await session.simulate(command.steps, command.frame)).map((r) =>
          r.kind === 'image' ? { kind: 'image' as const, dataUrl: r.value as string } : { kind: 'json' as const, data: r.value },
        ),
      };
  }
}

// --- the loop --------------------------------------------------------------------------------

let last = performance.now();
let viewSavedAt = 0;

/** One editor frame: fly the camera, tick the scene, draw. */
function step(dt: number): void {
  if (session.mode === 'edit') {
    controls.update(dt);
    // The rig accumulates yaw and pitch and only writes them to the camera here — once, after
    // every input adapter has had its say, so two of them can never fight over the transform.
    // Nothing called it, so the camera moved but never turned.
    rig.sync(dt);
  }
  session.tick(dt);
}

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  step(dt);
  if (now - viewSavedAt > 1000) {
    viewSavedAt = now;
    saveView();
  }
  requestAnimationFrame(frame);
}

/** A short-lived message for the top bar — a save, or why one was refused. */
function report(message: string): void {
  status = message;
  ui?.refresh();
  setTimeout(() => {
    if (status === message) {
      status = '';
      ui?.refresh();
    }
  }, 4000);
}

async function boot(): Promise<void> {
  ui = mountEditorUI({
    getEngine: () => session.engine,
    getDoc: () => doc ?? undefined,
    getModel: () => model ?? undefined,
    getScene: () => session.scene,
    onSelect: applySelection,
    focusSelected: (node) => frame_(session.frameNode(node)),

    handlers: {
      // Every one of these repaints the chrome afterwards, because the toolbar reads session
      // state at render time and only renders when asked to. Document edits get their repaint
      // from `doc.onChange`; nothing was raising one for the transport or the gizmo mode, so the
      // buttons kept whatever state they were last drawn with — press Play and Pause and Stop
      // stayed disabled, which made play mode a door with no handle on the inside.
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
      stop: () =>
        void session.stop().then(() => {
          ui?.refresh();
        }),
      getMode: () => gizmo?.mode ?? 'translate',
      setMode: (mode) => {
        gizmo?.setMode(mode);
        ui?.refresh();
      },
      // The space outlives any one gizmo: `attachGizmo` builds a new one for every scene, and a
      // person who chose Local does not expect Stop to put it back to World.
      getSpace: () => gizmoSpace,
      setSpace: (space) => {
        gizmoSpace = space;
        gizmo?.setSpace(space);
        ui?.refresh();
      },
      getShowUi: () => session.uiInEditor,
      setShowUi: (on) => {
        session.uiInEditor = on;
        ui?.refresh();
      },
      undo: () => doc?.undoLast(),
      redo: () => doc?.redoLast(),
      save: () => void save(),
      state: () => ({
        mode: session.mode,
        playing: session.playing,
        canUndo: doc?.canUndo ?? false,
        canRedo: doc?.canRedo ?? false,
        dirty: doc?.isDirty ?? false,
        saving: false,
        enabled: selected !== null && (doc?.canEditTransform(selected) ?? false),
        status,
      }),
    },

    // --- structural edits, all of them splices into the XML ---------------------------------
    reparent: (node, newParent, index) => doc?.moveNode(node, newParent, index),
    remove: (node) => doc?.removeNode(node),
    setId: (node, id) => doc?.setNodeAttr(node, 'id', id === '' ? null : id),

    /**
     * Copy takes the element's **source text**, so a paste reproduces what was authored —
     * comments, formatting and all — rather than a re-serialization of the live objects.
     */
    copy: (node) => {
      clipboard = doc?.sourceOf(node) ?? null;
      report(clipboard ? 'copied' : 'nothing to copy');
    },
    cut: (node) => {
      clipboard = doc?.sourceOf(node) ?? null;
      if (clipboard) doc?.removeNode(node);
    },
    paste: (parent) => {
      const target = parent ?? session.scene;
      if (clipboard && target) doc?.insertNode(target, clipboard);
    },
    hasClipboard: () => clipboard !== null,
    listDocuments: documents,
    openDocument: open,
  });

  // A named document opens straight away; without one the chrome shows its open dialog, which
  // is what it does whenever no document is open.
  const requested = new URLSearchParams(location.search).get('path');
  // A bad `?path` leaves the dialog up with the reason, which beats a blank page and a rejected
  // promise nobody sees.
  if (requested) await open(requested).catch((error: unknown) => report(String(error)));
  connect();
  requestAnimationFrame(frame);
}

/**
 * A handle on the live editor, for the console.
 *
 * An editor that cannot be poked at from devtools is one you debug by adding logging and
 * restarting. It costs one assignment.
 */
Object.assign(window as unknown as Record<string, unknown>, {
  scenoco: {
    get doc() {
      return doc;
    },
    get session() {
      return session;
    },
    get selected() {
      return selected;
    },
    get gizmo() {
      return gizmo;
    },
    controls,
    touchControls,
    rig,
    save,
    select,
    /**
     * Run frames by hand.
     *
     * `requestAnimationFrame` stops in a background tab, so this is the only way to exercise the
     * scene view — camera fly, gizmo drag — when nobody is looking at it. It runs exactly what
     * the loop runs; there is no second path.
     */
    step: (frames = 1, dt = 1 / 60) => {
      for (let i = 0; i < frames; i++) step(dt);
    },
  },
});

void boot();
