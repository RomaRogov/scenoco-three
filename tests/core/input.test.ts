import { describe, expect, it } from 'vitest';
import {
  Axis,
  Component,
  Engine,
  InputManager,
  KeyCode,
  MouseButton,
  component,
  keyCodeFromName,
  type PointerEventData,
} from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';

const ev = (type: string, props: Record<string, unknown> = {}): Event => Object.assign(new Event(type), props);

/** A canvas-shaped EventTarget: real listeners, fixed geometry, no WebGL. */
function fakeCanvas(width = 200, height = 100): HTMLCanvasElement {
  const canvas = new EventTarget() as unknown as HTMLCanvasElement;
  return Object.assign(canvas, {
    clientWidth: width,
    clientHeight: height,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
  });
}

describe('InputManager', () => {
  it('is neutral headless (no DOM) and nothing throws', () => {
    expect(typeof window).toBe('undefined');
    const input = new InputManager();
    input.beginFrame();
    expect(input.getKey(KeyCode.W)).toBe(false);
    expect(input.getMouseButton(MouseButton.Left)).toBe(false);
    expect(input.getAxis(Axis.Horizontal)).toBe(0);
    expect(input.getGamepad(0)).toBeNull();
    input.dispose();
  });

  it('synthetic injection drives key edges and a bottom-left-origin mouse position (tooling/simulate)', () => {
    const input = new InputManager({ canvas: fakeCanvas() });
    input.injectKey(KeyCode.Space, true);
    input.injectMouseMove(100, 25); // canvas-relative top-left px
    input.injectMouseButton(MouseButton.Left, true);
    input.beginFrame();
    expect(input.getKeyDown(KeyCode.Space)).toBe(true);
    expect(input.getMouseButtonDown(MouseButton.Left)).toBe(true);
    expect(input.mousePosition.y).toBe(75); // bottom-left origin: 100 - 25
    expect(input.mouseNdc.x).toBeCloseTo(0); // centre x

    input.beginFrame(); // edge clears, hold persists
    expect(input.getKeyDown(KeyCode.Space)).toBe(false);
    expect(input.getKey(KeyCode.Space)).toBe(true);
    input.injectKey(KeyCode.Space, false);
    input.beginFrame();
    expect(input.getKeyUp(KeyCode.Space)).toBe(true);
    input.dispose();
  });

  it('maps DOM key codes to Unity names and drives the virtual axes', () => {
    const win = new EventTarget();
    const input = new InputManager({ target: win });
    for (const code of ['KeyW', 'Digit1', 'ArrowLeft', 'ShiftLeft', 'ArrowUp', 'Numpad7']) {
      win.dispatchEvent(ev('keydown', { code }));
    }
    input.beginFrame();
    expect(input.getKey(KeyCode.W)).toBe(true); // physical KeyW → Unity 'W'
    expect(input.getKey(KeyCode.Alpha1)).toBe(true);
    expect(input.getKey(KeyCode.LeftArrow)).toBe(true);
    expect(input.getKey(KeyCode.LeftShift)).toBe(true);
    expect(input.getKey(KeyCode.Keypad7)).toBe(true); // numpad is its own key, not Alpha7
    expect(input.getKey(KeyCode.Alpha7)).toBe(false);
    expect(input.getAxis(Axis.Horizontal)).toBe(-1); // ArrowLeft held
    expect(input.getAxis(Axis.Vertical)).toBe(1); // ArrowUp held
    input.dispose();
  });

  it('resolves key names arriving as untyped strings, and rejects the ones that are not keys', () => {
    expect(keyCodeFromName('Space')).toBe(KeyCode.Space);
    expect(keyCodeFromName('Spce')).toBeUndefined(); // a typo is caught, not silently ignored
    expect(keyCodeFromName('toString')).toBeUndefined(); // inherited props are not key names
  });

  it('takes the pointer position from the press itself, with no mousemove first', () => {
    // The first click of a session often has no preceding move (the page loads or
    // regains focus under the cursor); the press must still be located where it
    // happened, not at a default centre-screen NDC.
    const canvas = fakeCanvas();
    const input = new InputManager({ canvas, target: new EventTarget() });
    canvas.dispatchEvent(ev('mousedown', { button: 0, clientX: 150, clientY: 25 }));
    input.beginFrame();
    expect(input.getMouseButtonDown(MouseButton.Left)).toBe(true);
    expect(input.mouseNdc.x).toBeCloseTo(0.5); // 150 of 200 px across
    expect(input.mouseNdc.y).toBeCloseTo(0.5); // 25 of 100 px down
    input.dispose();
  });

  it('releases held mouse buttons when the window loses focus', () => {
    // A press that ends outside the page delivers no mouseup; leaving the button
    // stuck "held" would make every later cursor move look like a drag.
    const canvas = fakeCanvas();
    const win = new EventTarget();
    const input = new InputManager({ canvas, target: win });
    canvas.dispatchEvent(ev('mousedown', { button: 0, clientX: 10, clientY: 10 }));
    input.beginFrame();
    expect(input.getMouseButton(MouseButton.Left)).toBe(true);

    win.dispatchEvent(ev('blur'));
    input.beginFrame();
    expect(input.getMouseButton(MouseButton.Left)).toBe(false);
    expect(input.getMouseButtonUp(MouseButton.Left)).toBe(true); // the release is still reported
    input.dispose();
  });
});

// A camera at z=5 looking down -Z at a box on the origin; the default pointer NDC
// (0,0) casts a ray straight through the box centre.
@component({ name: 'Clicker', description: 'Counts pointer down/up/click/drag' })
class Clicker extends Component {
  down = 0;
  up = 0;
  clicks = 0;
  drags = 0;
  lastDelta?: PointerEventData['delta'];
  lastButton?: MouseButton;
  override onPointerDown(e: PointerEventData): void { this.down++; this.lastButton = e.button; }
  override onPointerUp(): void { this.up++; }
  override onPointerClick(e: PointerEventData): void { this.clicks++; this.lastButton = e.button; }
  override onDrag(e: PointerEventData): void { this.drags++; this.lastDelta = e.delta; }
}

describe('engine: raycasting + pointer events', () => {
  const load = () => {
    const r = compileSceneXml(`<Scene><PerspectiveCamera position="0 0 5" fit="none" /><Mesh id="target"><Attachments><BoxGeometry /></Attachments><Components><Clicker /></Components></Mesh></Scene>`);
    if (!r.ok) throw new Error('compile failed');
    const engine = new Engine();
    engine.loadScene(bundleScene(r.scene));
    return engine;
  };

  it('raycasts the object under the pointer, dispatches down → drag → up + click over the same object', () => {
    const engine = load();
    expect(engine.raycast()[0]?.object).toBe(engine.findObject('target')); // centre ray hits the box
    const clicker = engine.findComponent('target', Clicker)!;

    engine.input.injectMouseButton(MouseButton.Left,true);
    engine.tick(1 / 60);
    expect(clicker.down).toBe(1);

    engine.input.injectMouseMove(0, 0, 6, -4); // held, pointer moves (dx, dy)
    engine.tick(1 / 60);
    expect(clicker.drags).toBe(1);
    expect(clicker.lastDelta?.x).toBe(6);

    engine.input.injectMouseButton(MouseButton.Left,false);
    engine.tick(1 / 60);
    expect(clicker.up).toBe(1);
    expect(clicker.clicks).toBe(1);
    engine.dispose();
  });

  it('stops delivering onDrag when the pressed object leaves the scene mid-press', () => {
    const engine = load();
    const clicker = engine.findComponent('target', Clicker)!;
    engine.input.injectMouseButton(MouseButton.Left,true);
    engine.tick(1 / 60);
    expect(clicker.down).toBe(1);
    engine.findObject('target')!.removeFromParent(); // detached (e.g. destroyed + flushed) while still pressed
    engine.input.injectMouseMove(0, 0, 6, -4);
    engine.tick(1 / 60);
    expect(clicker.drags).toBe(0); // pressed reference released, no drag to a detached subtree
    engine.dispose();
  });

  it('dispatches the right and middle buttons too, naming the button on the event', () => {
    const engine = load();
    const clicker = engine.findComponent('target', Clicker)!;

    engine.input.injectMouseButton(MouseButton.Right, true);
    engine.tick(1 / 60);
    expect(clicker.down).toBe(1);
    expect(clicker.lastButton).toBe(MouseButton.Right);

    engine.input.injectMouseButton(MouseButton.Right, false);
    engine.tick(1 / 60);
    expect(clicker.clicks).toBe(1);
    expect(clicker.lastButton).toBe(MouseButton.Right);
    engine.dispose();
  });

  it('tracks each button’s press target separately, so one release can’t end another button’s drag', () => {
    const engine = load();
    const clicker = engine.findComponent('target', Clicker)!;
    engine.input.injectMouseButton(MouseButton.Left, true);
    engine.tick(1 / 60);

    // A right press+release while the left is still held must not clear the left
    // button's target — the left drag has to survive it.
    engine.input.injectMouseButton(MouseButton.Right, true);
    engine.tick(1 / 60);
    engine.input.injectMouseButton(MouseButton.Right, false);
    engine.tick(1 / 60);

    engine.input.injectMouseMove(0, 0, 6, -4);
    engine.tick(1 / 60);
    expect(clicker.drags).toBe(1);
    engine.dispose();
  });

  it('fires onPointerUp but not onPointerClick when released off the pressed object', () => {
    const engine = load();
    const clicker = engine.findComponent('target', Clicker)!;
    engine.input.injectMouseButton(MouseButton.Left,true);
    engine.tick(1 / 60);
    engine.findObject('target')!.position.set(1000, 1000, 1000); // move out of the ray before release
    engine.input.injectMouseButton(MouseButton.Left,false);
    engine.tick(1 / 60);
    expect(clicker.up).toBe(1); // up still goes to the pressed object
    expect(clicker.clicks).toBe(0); // …but no click (released elsewhere)
    engine.dispose();
  });
});
