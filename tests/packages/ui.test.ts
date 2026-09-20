import { Group, type Object3D, PerspectiveCamera, Scene, Color } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { SceneManager, type SceneType } from '@scenoco-three/core';
import { Button, Canvas, Panel, Text, UIRenderer, toUikitProperties, type Anchor } from '@scenoco-three/ui';
import { Clock, resetEngine } from '../core/helpers.js';

afterEach(resetEngine);

function sceneOf(build: (scene: Scene) => void): SceneType {
  return class extends Scene {
    override onLoad(): void {
      build(this);
    }
  };
}

/**
 * What an element's authored values mean in uikit terms.
 *
 * Read from the element's own state rather than from uikit's `properties` signal, which holds
 * the *computed* result after layout and inheritance and stays empty until the element is
 * attached to a root with a renderer. This is the mapping this package is responsible for.
 */
function uikitProps(element: { _rect: Parameters<typeof toUikitProperties>[0] }): Record<string, unknown> {
  return toUikitProperties(element._rect);
}

describe('placement', () => {
  it('pins to a corner with insets measured inward', () => {
    const panel = new Panel();
    panel.anchor = 'topRight';
    panel.x = 24;
    panel.y = 16;
    panel.width = 200;

    const props = uikitProps(panel);
    expect(props.positionType).toBe('absolute');
    // Inward from the anchored edge, so both numbers are positive and neither is a coordinate.
    expect(props.positionRight).toBe(24);
    expect(props.positionTop).toBe(16);
    expect(props.positionLeft).toBeUndefined();
    expect(props.width).toBe(200);
  });

  /**
   * Where an anchored element actually lands, read off uikit's own layout rather than the
   * properties handed to it. A mapping test passed for months while every centred anchor drew in
   * the top-left corner: yoga ignores the auto margins the mapping produced.
   */
  const landing = async (anchor: Anchor, x = 0, y = 0): Promise<number[]> => {
    let child!: Panel;
    const scene = await SceneManager.load(
      sceneOf((s) => {
        const parent = new Panel();
        parent.width = 400;
        parent.height = 300;
        s.add(parent);
        child = new Panel();
        child.anchor = anchor;
        child.width = 100;
        child.height = 50;
        child.x = x;
        child.y = y;
        parent.add(child);
      }),
    );
    scene.getSystem(UIRenderer)!.layout(0);
    // Centre of the element relative to its parent's centre, y up.
    const [cx, cy] = (child as unknown as { relativeCenter: { peek(): [number, number] } }).relativeCenter.peek();
    return [cx + 0, cy + 0]; // -0 → 0: a centre is a centre
  };

  it('lands every anchor where its name says, not in the top-left corner', async () => {
    expect(await landing('center')).toEqual([0, 0]);
    expect(await landing('top')).toEqual([0, 125]);
    expect(await landing('left')).toEqual([-150, 0]);
    expect(await landing('bottomRight')).toEqual([150, -125]);
  });

  it('centres an element with no size written by the size of what it holds', async () => {
    // A dialog is a title and a button; nobody measures it. With no height it filled the whole
    // screen, and two builds in a row sized their panels by hand after a screenshot said so.
    let dialog!: Panel;
    const scene = await SceneManager.load(
      sceneOf((s) => {
        const parent = new Panel();
        parent.width = 400;
        parent.height = 300;
        s.add(parent);
        dialog = new Panel();
        dialog.anchor = 'center';
        parent.add(dialog);
        const content = new Panel();
        content.width = 120;
        content.height = 40;
        dialog.add(content);
      }),
    );
    scene.getSystem(UIRenderer)!.layout(0);
    const view = dialog as unknown as { size: { peek(): number[] }; relativeCenter: { peek(): number[] } };
    expect(view.size.peek()).toEqual([120, 40]);
    expect(view.relativeCenter.peek().map((v) => v + 0)).toEqual([0, 0]);
  });

  it('shifts a centred element by exactly the offset', async () => {
    // Forty below centre and thirty right: `y` grows down the screen at every anchor.
    expect(await landing('center', 30, 40)).toEqual([30, -40]);
  });

  it('stretches an axis and takes x as its inset on both sides', () => {
    const panel = new Panel();
    panel.anchor = 'stretchTop';
    panel.x = 12;
    panel.height = 64;

    const props = uikitProps(panel);
    expect(props.positionLeft).toBe(12);
    expect(props.positionRight).toBe(12);
    expect(props.positionTop).toBe(0);
    expect(props.height).toBe(64);
    // A stretched axis has no width to give: the stretch is the width.
    expect(props.width).toBeUndefined();
  });

  it('leaves an element in its parent’s flow when no anchor is written', () => {
    const panel = new Panel();
    panel.width = 100;

    const props = uikitProps(panel);
    expect(props.positionType).not.toBe('absolute');
    expect(props.width).toBe(100);
  });

  it('does not depend on the order the attributes were written in', () => {
    const a = new Panel();
    a.anchor = 'bottomLeft';
    a.x = 8;
    a.width = 120;

    const b = new Panel();
    b.width = 120;
    b.x = 8;
    b.anchor = 'bottomLeft';

    const [pa, pb] = [uikitProps(a), uikitProps(b)];
    for (const key of ['positionType', 'positionLeft', 'positionBottom', 'width']) {
      expect(pb[key], key).toEqual(pa[key]);
    }
  });
});

describe('laying out children', () => {
  /**
   * The point of `alignX`/`alignY`: they mean horizontally and vertically whatever the stacking
   * direction is. CSS swaps which of `justify-content` and `align-items` does which, and that
   * swap is the usual reason a flexbox layout comes out sideways.
   */
  it('maps alignX to the horizontal axis whichever way the stack runs', () => {
    const column = new Panel();
    column.layout = 'vertical';
    column.alignX = 'center';
    expect(uikitProps(column).alignItems).toBe('center');
    expect(uikitProps(column).justifyContent).toBe('flex-start');

    const row = new Panel();
    row.layout = 'horizontal';
    row.alignX = 'center';
    expect(uikitProps(row).justifyContent).toBe('center');
    expect(uikitProps(row).alignItems).toBe('flex-start');
  });

  it('carries gap and padding straight through', () => {
    const panel = new Panel();
    panel.gap = 12;
    panel.padding = 24;
    expect(uikitProps(panel).gap).toBe(12);
    expect(uikitProps(panel).padding).toBe(24);
  });
});

describe('appearance and text', () => {
  it('names the background and the text colour separately', () => {
    const panel = new Panel();
    panel.background = new Color(0x111827);
    panel.color = new Color(0xffffff);
    panel.radius = 12;

    const props = uikitProps(panel);
    // `background` fills the rectangle; `color` is the text colour every label inside inherits.
    expect(props.backgroundColor).toBeInstanceOf(Color);
    expect(props.borderRadius).toBe(12);
    expect(props.color).toBeInstanceOf(Color);
  });

  it('reads and writes text the same way a document and game code do', () => {
    const label = new Text();
    label.text = 'SCORE 0';
    expect(label.text).toBe('SCORE 0');
    expect(uikitProps(label).text).toBe('SCORE 0');

    label.text = 'SCORE 12';
    expect(uikitProps(label).text).toBe('SCORE 12');
  });
});

describe('reaching uikit', () => {
  /**
   * The mapping above is a pure function; this is the wiring. Assigning an attribute has to push
   * the *whole* set onto uikit, which is what makes the result independent of write order and
   * makes `label.text = …` from game code the same path a document takes.
   */
  it('pushes the whole property set to uikit on every assignment', () => {
    const panel = new Panel();
    const seen: Array<Record<string, unknown>> = [];
    const target = panel as unknown as { setProperties(p: Record<string, unknown>): void };
    const original = target.setProperties.bind(target);
    target.setProperties = (props) => {
      seen.push(props);
      original(props);
    };

    panel.anchor = 'bottomRight';
    panel.x = 16;

    expect(seen).toHaveLength(2);
    // The second write carries the anchor from the first, not just the value that changed.
    expect(seen[1]).toMatchObject({ positionType: 'absolute', positionRight: 16 });
  });
});

describe('the renderer system', () => {
  it('is created on demand by the first element in the scene', async () => {
    const scene = await SceneManager.load(
      sceneOf((s) => {
        const panel = new Panel();
        s.add(panel);
      }),
    );
    expect(scene.getSystem(UIRenderer)).toBeInstanceOf(UIRenderer);
  });

  it('finds its scene through however many parents it took to get there', async () => {
    const scene = await SceneManager.load(
      sceneOf((s) => {
        // Built detached and added afterwards, the way a prefab builds its subtree.
        const holder = new Group();
        const panel = new Panel();
        holder.add(panel);
        s.add(holder);
      }),
    );
    expect(scene.getSystem(UIRenderer)).toBeInstanceOf(UIRenderer);
  });

  it('ticks headless without a renderer, so a scene with UI still runs in a test', async () => {
    await SceneManager.load(
      sceneOf((s) => {
        const camera = new PerspectiveCamera();
        s.add(camera);
        s.mainCamera = camera;
        const canvas = new Canvas();
        camera.add(canvas);
        const panel = new Panel();
        panel.anchor = 'stretchTop';
        panel.height = 64;
        canvas.add(panel);
      }),
    );
    expect(() => new Clock().frames(3)).not.toThrow();
  });
});

/**
 * A UI layout is presentation, not simulation.
 *
 * It is arithmetic over the current state, so it is as valid on a paused frame as a running one
 * — which is what lets an editor sitting in edit mode show a HUD without starting the game.
 * Physics deliberately has no such pass: stepping a world twice in a frame is not free.
 */
describe('laying out on a frame that is not simulated', () => {
  it('offers a layout pass the simulation does not have to run', async () => {
    const scene = await SceneManager.load(
      sceneOf((s) => {
        const camera = new PerspectiveCamera();
        s.add(camera);
        camera.add(new Canvas());
      }),
    );
    const ui = scene.getSystem(UIRenderer)!;
    expect(typeof ui.layout).toBe('function');
    expect(() => ui.layout(1 / 60)).not.toThrow(); // headless: lays out, draws nothing
  });
});

/**
 * The two flags every node has, on an element uikit draws.
 *
 * `active` is out of the layout entirely and `visible` is hidden but still in place — the same
 * distinction they carry on any other node. Neither is three's `visible` field here: uikit
 * writes that itself, from its own layout and traversal, so an assignment to it is overwritten
 * within the frame and a "hidden" 80%-opaque banner in front of the camera dimmed the whole
 * game with nothing in the scene graph to show for it.
 */
describe('hiding an element', () => {
  const displayOf = (element: object): unknown =>
    (element as { properties: { peek(): { display?: unknown } } }).properties.peek().display;
  const visibilityOf = (element: object): unknown =>
    (element as { properties: { peek(): { visibility?: unknown } } }).properties.peek().visibility;

  const banner = async (): Promise<{ scene: Scene; panel: Object3D; label: Object3D }> => {
    const scene = await SceneManager.load(
      sceneOf((s) => {
        const camera = new PerspectiveCamera();
        s.add(camera);
        const canvas = new Canvas();
        camera.add(canvas);
        const panel = new Panel();
        panel.name = 'banner';
        canvas.add(panel);
        const label = new Panel();
        label.name = 'label';
        panel.add(label);
      }),
    );
    return { scene, panel: scene.getObjectByName('banner')!, label: scene.getObjectByName('label')! };
  };

  it('takes `visible` out of the drawing and leaves it in the layout', async () => {
    const { scene, panel, label } = await banner();
    expect(panel.visible).toBe(true);
    // Being added to a parent is when uikit recomputes the traversal flag it keeps in three's
    // `visible`, and that write must not read as an author hiding the element.
    expect(label.visible).toBe(true);

    panel.visible = false;
    scene.getSystem(UIRenderer)!.layout(1 / 60);
    expect(panel.visible).toBe(false);
    expect(visibilityOf(panel)).toBe('hidden');
    expect(displayOf(panel)).toBe('flex'); // still laid out: nothing beside it moves

    panel.visible = true;
    scene.getSystem(UIRenderer)!.layout(1 / 60);
    expect(visibilityOf(panel)).toBe('visible');
  });

  it('lays out a change of active state on the pass that sees it, not the one after', async () => {
    // A root is built before its children, so it is met first; syncing each element as the loop
    // reached it laid the root out before its children's `setActive` had been read, and every
    // hidden or shown element moved a frame late — a same-batch capture missed the end panel.
    let first!: Panel;
    let second!: Panel;
    const scene = await SceneManager.load(
      sceneOf((s) => {
        const column = new Panel();
        column.width = 100;
        column.height = 100;
        s.add(column);
        first = new Panel();
        second = new Panel();
        for (const cell of [first, second]) {
          cell.width = 10;
          cell.height = 10;
          column.add(cell);
        }
      }),
    );
    const ui = scene.getSystem(UIRenderer)!;
    const top = (element: Panel): number =>
      (element as unknown as { relativeCenter: { peek(): [number, number] } }).relativeCenter.peek()[1];
    ui.layout(0);
    const below = top(second);

    first.setActive(false);
    ui.layout(0);
    expect(top(second)).toBe(below + 10); // moved up into the space `first` left, in one pass
  });

  it('follows the node’s active state', async () => {
    const scene = await SceneManager.load(
      sceneOf((s) => {
        const camera = new PerspectiveCamera();
        s.add(camera);
        const canvas = new Canvas();
        camera.add(canvas);
        const panel = new Panel();
        panel.name = 'banner';
        canvas.add(panel);
      }),
    );
    const ui = scene.getSystem(UIRenderer)!;
    const panel = scene.getObjectByName('banner')!;

    ui.layout(1 / 60);
    expect(displayOf(panel)).toBe('flex');

    panel.setActive(false);
    ui.layout(1 / 60);
    expect(displayOf(panel)).toBe('none');

    // And back: `setProperties` merges, so a `display` left from an inactive moment would stick.
    panel.setActive(true);
    ui.layout(1 / 60);
    expect(displayOf(panel)).toBe('flex');

    // Shown and hidden again before a layout — a round that starts and is lost in one frame. The
    // element had already been written as shown, so the frame's net "no change" left it drawn.
    panel.setActive(false);
    ui.layout(1 / 60);
    panel.setActive(true);
    panel.setActive(false);
    ui.layout(1 / 60);
    expect(displayOf(panel)).toBe('none');
  });
});

describe('moving an element after the scene is running', () => {
  /**
   * A UI element is a class and its attributes are its properties, so moving one is assigning to
   * it — the same rule every other node in the framework follows. Worth pinning because it is the
   * thing a HUD does that a document cannot: a health bar that follows a character, a marker that
   * tracks a target, a joystick that appears under a thumb.
   */
  it('moves when x and y are assigned mid-run', async () => {
    let panel!: Panel;
    await SceneManager.load(
      sceneOf((scene) => {
        const camera = new PerspectiveCamera();
        scene.add(camera);
        scene.mainCamera = camera;
        scene.addSystem(UIRenderer);
        const canvas = new Canvas();
        camera.add(canvas);
        panel = new Panel();
        panel.anchor = 'topLeft';
        panel.width = 80;
        panel.height = 80;
        panel.x = 10;
        panel.y = 10;
        canvas.add(panel);
      }),
    );
    new Clock().frame();
    expect(uikitProps(panel).positionLeft).toBe(10);
    expect(uikitProps(panel).positionTop).toBe(10);

    panel.x = 140;
    panel.y = 220;
    expect(uikitProps(panel).positionLeft).toBe(140);
    expect(uikitProps(panel).positionTop).toBe(220);
  });

  it('re-anchors, so an element can change which corner it hangs from', async () => {
    const panel = new Panel();
    panel.anchor = 'topLeft';
    panel.x = 12;
    panel.y = 12;
    expect(uikitProps(panel).positionLeft).toBe(12);

    panel.anchor = 'bottomRight';
    const props = uikitProps(panel);
    expect(props.positionLeft).toBeUndefined();
    expect(props.positionRight).toBe(12);
    expect(props.positionBottom).toBe(12);
  });
});

/**
 * A clickable element — Unity's `Button`, with its `onClick` as a typed event.
 *
 * The pointer already reached the scene; what was missing was a way to say "this is a button"
 * without a string event name or hand-rolled hit testing against `Input.mousePosition`.
 */
describe('a button', () => {
  const pressable = async (): Promise<{ panel: Panel; button: Button }> => {
    let panel!: Panel;
    await SceneManager.load(
      sceneOf((s) => {
        panel = new Panel();
        s.add(panel);
        panel.addComponent(Button);
      }),
    );
    return { panel, button: panel.getComponent(Button)! };
  };
  // What uikit's pointer handling dispatches on the element the pointer went down and up on.
  const click = (panel: Panel): void => void panel.dispatchEvent({ type: 'click' } as never);

  it('raises onClick once per click', async () => {
    const { panel, button } = await pressable();
    let clicks = 0;
    button.onClick.on(() => clicks++);
    click(panel);
    click(panel);
    expect(clicks).toBe(2);
  });

  it('copies with its own click: instantiate(panel) answers on the copy, not the original', async () => {
    const { panel, button } = await pressable();
    panel.width = 120;
    const label = new Text();
    label.text = 'PLAY AGAIN';
    panel.add(label);
    const copy = panel.scene!.instantiate(panel);
    const copied = copy.getComponent(Button)!;
    let originals = 0;
    let copies = 0;
    button.onClick.on(() => originals++);
    copied.onClick.on(() => copies++);
    click(copy);
    expect([originals, copies]).toEqual([0, 1]);
    expect(copy).toBeInstanceOf(Panel);
    expect(copy.width).toBe(120);
    const copiedLabel = copy.children.find((child) => child instanceof Text) as Text | undefined;
    expect(copiedLabel?.text).toBe('PLAY AGAIN');
    expect(copiedLabel).not.toBe(label);
  });

  it('takes no clicks while not interactable, or while its element is inactive', async () => {
    const { panel, button } = await pressable();
    let clicks = 0;
    button.onClick.on(() => clicks++);
    button.interactable = false;
    click(panel);
    button.interactable = true;
    panel.setActive(false);
    click(panel);
    expect(clicks).toBe(0);
  });
});
