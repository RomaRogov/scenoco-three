import { Box3, Box3Helper, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, type Camera, type Light, type Object3D } from 'three';
import { setView, type Game, type EditorViewport, type ViewportEvents } from '@scenoco/kernel/internal';
import { EditorGrid } from './grid.js';
import { Flythrough } from './flythrough.js';
import { fingerPads } from './gizmo.js';

/**
 * three.js's view of a game under the editor: paused, it looks through its own camera — orbit, and
 * Unity's flythrough on the right button — with a gizmo, an outline round the selection and a ground
 * grid. What the user does here goes to the kernel's editor as `events`.
 */
export async function openViewport(game: Game, events: ViewportEvents): Promise<EditorViewport> {
  const [{ OrbitControls }, { TransformControls }] = await Promise.all([
    import('three/addons/controls/OrbitControls.js'),
    import('three/addons/controls/TransformControls.js'),
  ]);
  const { scene, runtime } = game;
  const renderer = game.renderer;
  const canvas = renderer.domElement;

  const camera = new PerspectiveCamera(50, 1, 0.05, 5000);
  const orbit = new OrbitControls(camera, canvas);
  orbit.enabled = false;
  // A pinch or the wheel goes towards what is under the fingers or the cursor, as in Unity.
  orbit.zoomToCursor = true;
  const fly = new Flythrough(camera, canvas, orbit);
  const gizmo = new TransformControls(camera, canvas);
  gizmo.enabled = false;
  const overlay = new Scene();
  overlay.add(gizmo.getHelper());
  const grid = new EditorGrid();
  overlay.add(grid);
  const box = new Box3();
  const outline = new Box3Helper(box, 0x38bdf8);
  outline.visible = false;
  overlay.add(outline);
  const size = new Vector2();
  let selected: Object3D | null = null;
  /** What isolation hid, and whether it was visible before. */
  const isolated = new Map<Object3D, boolean>();

  /** Paused, the editor looks through its own camera, from where the game's stood the first time. */
  let placed = false;
  const lookThrough = (paused: boolean) => {
    orbit.enabled = paused;
    fly.enabled = paused;
    gizmo.enabled = paused;
    grid.visible = paused;
    if (paused && selected) gizmo.attach(selected);
    else gizmo.detach();
    if (paused && !placed) {
      placed = true;
      const from = game.camera as Camera | null;
      if (from) {
        from.updateMatrixWorld();
        from.matrixWorld.decompose(camera.position, camera.quaternion, new Vector3());
      } else camera.position.set(0, 5, 10);
      orbit.target.copy(camera.position).add(camera.getWorldDirection(new Vector3()).multiplyScalar(10));
    }
    setView(runtime, paused ? camera : null);
  };

  gizmo.addEventListener('objectChange', () => {
    if (selected) events.dragged(selected);
  });
  let before: { position: number[]; rotation: number[]; scale: number[] } | null = null;
  gizmo.addEventListener('dragging-changed', (event) => {
    orbit.enabled = !event.value && !fly.flying;
    const node = selected;
    if (!node) return;
    if (event.value) before = { position: node.position.toArray(), rotation: [node.rotation.x, node.rotation.y, node.rotation.z], scale: node.scale.toArray() };
    else if (before) events.dropped(node, before);
  });

  // A tap while paused — not the end of an orbit drag — picks what is under it.
  const paused = () => gizmo.enabled;
  const at = new Vector2();
  const raycaster = new Raycaster();
  const down = (event: PointerEvent) => void at.set(event.clientX, event.clientY);
  const up = (event: PointerEvent) => {
    if (!paused() || event.button !== 0 || at.distanceTo(new Vector2(event.clientX, event.clientY)) > 4 || gizmo.dragging) return;
    const rect = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1), camera);
    events.picked(raycaster.intersectObject(scene, true).find((hit) => hit.object.visible)?.object ?? null);
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointerup', up);

  // Orbit turns, pans and zooms at speeds that scale with the distance to its target. Before each
  // gesture the target moves to what is straight ahead — along the view, so nothing turns — and so
  // the speeds suit what is being looked at, not a framed object's middle or a point in the air.
  const pressed = new Set<number>();
  const ahead = new Vector2();
  const retarget = () => {
    if (!paused() || fly.flying || gizmo.dragging) return;
    raycaster.setFromCamera(ahead, camera);
    const hit = raycaster.intersectObject(scene, true).find((h) => h.object.visible);
    if (!hit) return;
    orbit.target.copy(camera.position).add(camera.getWorldDirection(new Vector3()).multiplyScalar(Math.max(hit.distance, 0.5)));
  };
  // Capture comes first on the canvas: the target is moved before orbit reads it.
  const press = (event: PointerEvent) => {
    fingerPads(gizmo, event.pointerType === 'touch');
    // A second finger joins a gesture already going: the target stays.
    if (pressed.size === 0) retarget();
    pressed.add(event.pointerId);
  };
  const release = (event: PointerEvent) => void pressed.delete(event.pointerId);
  canvas.addEventListener('pointerdown', press, { capture: true });
  addEventListener('pointerup', release);
  addEventListener('pointercancel', release);
  canvas.addEventListener('wheel', retarget, { capture: true, passive: true });

  let last = performance.now();
  return {
    lookThrough,
    select(node) {
      selected = node as Object3D | null;
      if (selected && gizmo.enabled) gizmo.attach(selected);
      else gizmo.detach();
      outline.visible = selected !== null;
    },
    setMode: (mode) => gizmo.setMode(mode),
    frame(node) {
      box.setFromObject(node);
      // A node with nothing to draw — a spline's knot, a spawn point — is framed where it stands.
      const center = box.isEmpty() ? node.getWorldPosition(new Vector3()) : box.getCenter(new Vector3());
      const radius = box.isEmpty() ? 2 : Math.max(box.getSize(new Vector3()).length() / 2, 0.5);
      camera.position.copy(center).add(camera.getWorldDirection(new Vector3()).multiplyScalar(-radius * 3));
      orbit.target.copy(center);
    },
    isolate(node) {
      for (const [hidden, was] of isolated) hidden.visible = was;
      isolated.clear();
      if (!node) return;
      // Everything off the way from the root to the node, and beside it, is hidden; the way itself
      // stays, and so do the lights, or what is isolated would sit in the dark.
      for (let keep: Object3D = node; keep.parent; keep = keep.parent) {
        for (const sibling of keep.parent.children) {
          if (sibling === keep || isolated.has(sibling) || (sibling as Light).isLight) continue;
          isolated.set(sibling, sibling.visible);
          sibling.visible = false;
        }
      }
    },
    draw(drawn) {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (paused()) {
        renderer.getSize(size);
        camera.aspect = size.x / size.y;
        camera.updateProjectionMatrix();
        fly.update(dt);
        // Orbit controls turn the camera to their target: not while it looks around on its own.
        if (!fly.flying) orbit.update();
        grid.follow(camera);
      }
      if (selected) box.setFromObject(selected);
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(overlay, drawn);
      renderer.autoClear = auto;
    },
    dispose() {
      orbit.dispose();
      fly.dispose();
      gizmo.dispose();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointerdown', press, { capture: true });
      removeEventListener('pointerup', release);
      removeEventListener('pointercancel', release);
      canvas.removeEventListener('wheel', retarget, { capture: true });
    },
  };
}
