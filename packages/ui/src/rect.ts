import type { Color, Object3D, Scene, Texture } from 'three';
import { Component as UikitComponent } from '@pmndrs/uikit';

/**
 * Where an element sits in its parent — Unity's RectTransform anchor presets, as one attribute.
 *
 * Unity's inspector shows a 3×3 grid of corners plus stretch rows and columns, and nobody types
 * `anchorMin`/`anchorMax`/`pivot` by hand; they pick a preset. These are those presets.
 *
 * ```text
 *   topLeft      top       topRight        stretchTop     ▔▔▔▔▔▔▔▔
 *   left        center        right        stretchBottom  ▁▁▁▁▁▁▁▁
 *   bottomLeft  bottom   bottomRight       stretchLeft    ▏
 *                                          stretchRight          ▕
 *                                          stretch        ████████
 * ```
 *
 * Writing an `anchor` takes the element **out of its parent's layout** and pins it, which is the
 * same rule Unity follows. Leave it off and the parent's `layout` places it.
 */
export type Anchor =
  | 'topLeft'
  | 'top'
  | 'topRight'
  | 'left'
  | 'center'
  | 'right'
  | 'bottomLeft'
  | 'bottom'
  | 'bottomRight'
  | 'stretchTop'
  | 'stretchBottom'
  | 'stretchLeft'
  | 'stretchRight'
  | 'stretch';

/** Which way children are stacked. */
export type Layout = 'vertical' | 'horizontal';

/**
 * How children line up — as an **absolute direction**, not a flexbox axis.
 *
 * `alignX` always means horizontally and `alignY` always means vertically, whichever way
 * `layout` runs. CSS calls one of them `justify-content` and the other `align-items` and swaps
 * which is which when the direction changes; that swap is the single most common way flexbox
 * layout comes out sideways, and there is no reason a document should have to model it.
 */
export type Align = 'start' | 'center' | 'end' | 'stretch' | 'between';

/** Text weight. uikit takes a number too; these are the two anyone writes. */
export type FontWeight = 'normal' | 'bold';

/** Horizontal alignment of text inside its element. */
export type TextAlign = 'left' | 'center' | 'right';

declare module '@pmndrs/uikit' {
  /**
   * The whole authoring surface of a UI element, merged onto uikit's base class so every element
   * has it — the same mechanism core uses to put `addComponent` on `THREE.Object3D`.
   *
   * Every value here is a **number, a colour, or a short enum**. There are no CSS length strings,
   * because a rectangle either has a size or it stretches, which is exactly what Unity's
   * RectTransform says.
   */
  interface Component {
    // --- placement (RectTransform) --------------------------------------------------------
    /** Where in the parent this sits. Writing one pins the element; leaving it off lets the parent's `layout` place it. */
    anchor?: Anchor;
    /** Distance in from the anchored edge, in pixels. At a centre anchor, an offset from centre. */
    x: number;
    /** Distance in from the anchored edge, in pixels. At a centre anchor, an offset from centre. */
    y: number;
    /**
     * Width in pixels. Leave it off on a stretched axis — the stretch is the width — or to size
     * the element by what it holds.
     *
     * @tip A size is pixels, never a percentage or "auto": to fill the parent, anchor it
     * (anchor="stretch", "stretchTop", …); to fit what it holds, leave width off.
     */
    width?: number;
    /**
     * Height in pixels. Leave it off on a stretched axis, or to size the element by what it holds.
     *
     * @tip A size is pixels, never a percentage or "auto": to fill the parent, anchor it
     * (anchor="stretch", "stretchLeft", …); to fit what it holds, leave height off.
     */
    height?: number;

    // --- children ---------------------------------------------------------------------------
    /** Which way children are stacked. */
    layout: Layout;
    /** How children line up horizontally, whichever way `layout` runs. */
    alignX: Align;
    /** How children line up vertically, whichever way `layout` runs. */
    alignY: Align;
    /** Space between children, in pixels. */
    gap: number;
    /**
     * Space inside the element's own edges, in pixels, for the children its `layout` places. An
     * anchored child is pinned to the edge itself — its own `x`/`y` are its margin.
     */
    padding: number;

    // --- appearance -------------------------------------------------------------------------
    /** Fill colour of the element's rectangle. Omitted, it draws nothing. */
    background?: Color;
    /** Corner radius, in pixels. */
    radius: number;
    /** Border thickness, in pixels. */
    border: number;
    /** Border colour. */
    borderColor?: Color;
    /**
     * `0`..`1` for the whole element. **Inherited**, so it fades this element's text and
     * children with it — which is what you want for fading a panel in and out, and not what you
     * want for a translucent bar behind readable text. That is `backgroundOpacity`.
     */
    opacity: number;
    /**
     * `0`..`1` for the element's fill alone, leaving its text and children opaque.
     *
     * The HUD idiom CSS writes as `#0f172acc`. A colour here is a `THREE.Color`, which has no
     * alpha channel at all, so the transparency is its own number: `background="#0f172a"
     * backgroundOpacity="0.85"`.
     */
    backgroundOpacity: number;

    // --- text, inherited by descendants like CSS ---------------------------------------------
    /** Text colour. Inherited, so setting it on a panel colours every label inside. */
    color?: Color;
    /** Text size in pixels. Inherited. */
    fontSize?: number;
    /** Inherited. */
    fontWeight?: FontWeight;
    /** Inherited. */
    textAlign?: TextAlign;

    /** @internal every authored value, and the one place they are written from. */
    _rect: RectState;
  }
}

/** Everything a document may set on one element, before it is turned into uikit properties. */
export interface RectState {
  /** three's `visible`, kept here because uikit owns the field — see `ownVisible`. */
  visible: boolean;
  anchor?: Anchor;
  x: number;
  y: number;
  width?: number;
  height?: number;
  layout: Layout;
  alignX: Align;
  alignY: Align;
  gap: number;
  padding: number;
  background?: Color;
  radius: number;
  border: number;
  borderColor?: Color;
  opacity: number;
  backgroundOpacity: number;
  color?: Color;
  fontSize?: number;
  fontWeight?: FontWeight;
  textAlign?: TextAlign;
  /** `<Text>` only. */
  text?: string;
  /** `<Image>` only. */
  src?: Texture;
}

/**
 * What layout worked out for one element, as against what was authored on it. It belongs to the
 * element that was laid out, so a copy of the element starts without it.
 */
export interface LayoutState {
  /**
   * The size layout gave a centred axis that has none written, so it can be centred by its
   * content — see `centreBySize`.
   */
  measured?: [number, number];
  /**
   * The active state uikit was last given. `setActive` assigns `visible` before it updates the
   * hierarchy, so a write can carry the state being left; what was written is the only thing to
   * compare against.
   */
  applied?: boolean;
}

function freshState(): RectState {
  return {
    visible: true,
    x: 0,
    y: 0,
    layout: 'vertical',
    alignX: 'start',
    alignY: 'start',
    gap: 0,
    padding: 0,
    radius: 0,
    border: 0,
    opacity: 1,
    backgroundOpacity: 1,
  };
}

const states = new WeakMap<object, RectState>();
const layouts = new WeakMap<object, LayoutState>();

/** @internal what layout worked out for an element, created on first touch. */
export function layoutStateOf(element: object): LayoutState {
  let state = layouts.get(element);
  if (!state) layouts.set(element, (state = {}));
  return state;
}

/** @internal the authored values for an element, created on first touch. */
export function rectStateOf(element: object): RectState {
  let state = states.get(element);
  if (!state) states.set(element, (state = freshState()));
  return state;
}

/**
 * Push every authored value onto the element as uikit properties.
 *
 * The **whole** set is written every time rather than the one that changed, so the result never
 * depends on the order a document wrote its attributes in — the same rule the placement
 * attributes follow on an ordinary node.
 */
export function applyRect(element: UikitComponent): void {
  const state = rectStateOf(element);
  const layout = layoutStateOf(element);
  const props = toUikitProperties(state, layout.measured);
  // The two flags every node has, in uikit's spelling.
  //
  // `active` is `display: 'none'`: out of the layout entirely, so the elements around it close
  // up, which is what turning a node off means. `visible` is `visibility: 'hidden'`: still laid
  // out, still updating, simply not drawn — the same difference the two carry on any other node.
  //
  // Both are written every time and never omitted, because `setProperties` merges: a `display:
  // 'none'` left over from an inactive moment would stick for ever once the element came back.
  const active = (element as unknown as { activeInHierarchy?: boolean }).activeInHierarchy !== false;
  props.display = active ? 'flex' : 'none';
  layout.applied = active;
  props.visibility = state.visible ? 'visible' : 'hidden';
  asUikit(() => (element as unknown as { setProperties(p: Record<string, unknown>): void }).setProperties(props));
}

/**
 * Run `body` as uikit's own work.
 *
 * uikit reacts to a property change by running its effects there and then, and one of those
 * effects assigns three's `visible` field. Marking the moment is what lets `ownVisible` tell
 * uikit's answer from an author's assignment; the two are otherwise the same statement.
 */
export function asUikit<T>(body: () => T): T {
  const outer = insideUikit;
  insideUikit = true;
  try {
    return body();
  } finally {
    insideUikit = outer;
  }
}

let insideUikit = false;

/**
 * Give this element a `visible` of its own.
 *
 * `visible` means the same thing on every node — hidden, but still there and still updating —
 * and on a UI element that is uikit's `visibility: 'hidden'`, which drops the element out of
 * the drawing without moving anything around it. What it is not is three's `visible` field:
 * uikit writes that itself whenever its layout, clipping or traversal changes, so a value
 * assigned there is gone again within the frame.
 *
 * So the field becomes an accessor. An assignment from outside uikit is the author's, and goes
 * on to uikit as a property; one from inside is uikit's own answer about drawing. That answer
 * is what three should read back on an element with a mesh of its own, and is worth nothing on
 * one drawn through the shared panel mesh, where the flag only says whether there is anything
 * inside worth walking into.
 */
export function ownVisible(element: UikitComponent, hasOwnMesh: boolean): void {
  let uikit = true;
  Object.defineProperty(element, 'visible', {
    configurable: true,
    enumerable: true,
    get(this: UikitComponent): boolean {
      return rectStateOf(this).visible && (hasOwnMesh ? uikit : true);
    },
    set(this: UikitComponent, value: boolean) {
      if (insideUikit) {
        uikit = value;
        return;
      }
      rectStateOf(this).visible = value;
      applyRect(this);
    },
  });
}

/** The anchor presets, split into what each does horizontally and vertically. */
const ANCHORS: Record<Anchor, [x: 'left' | 'center' | 'right' | 'stretch', y: 'top' | 'middle' | 'bottom' | 'stretch']> = {
  topLeft: ['left', 'top'],
  top: ['center', 'top'],
  topRight: ['right', 'top'],
  left: ['left', 'middle'],
  center: ['center', 'middle'],
  right: ['right', 'middle'],
  bottomLeft: ['left', 'bottom'],
  bottom: ['center', 'bottom'],
  bottomRight: ['right', 'bottom'],
  stretchTop: ['stretch', 'top'],
  stretchBottom: ['stretch', 'bottom'],
  stretchLeft: ['left', 'stretch'],
  stretchRight: ['right', 'stretch'],
  stretch: ['stretch', 'stretch'],
};

const JUSTIFY: Record<Align, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  // Nothing to stretch *along* the stacking direction — `flexGrow` on the children is what does
  // that, and it is not something a document says. Treated as "leave them where they start".
  stretch: 'flex-start',
};

const ALIGN: Record<Align, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
  between: 'stretch',
};

/** Turn the authored values into the uikit property object. */
export function toUikitProperties(
  state: RectState,
  /** What layout measured of an element sized by its content — see `centreBySize`. */
  measured?: readonly [number, number],
): Record<string, unknown> {
  const row = state.layout === 'horizontal';
  const props: Record<string, unknown> = {
    flexDirection: row ? 'row' : 'column',
    // `alignX`/`alignY` are absolute directions; this is the one place the axis swap lives.
    justifyContent: (row ? JUSTIFY[state.alignX] : JUSTIFY[state.alignY]),
    alignItems: (row ? ALIGN[state.alignY] : ALIGN[state.alignX]),
    gap: state.gap,
    padding: state.padding,
    borderRadius: state.radius,
    borderWidth: state.border,
    opacity: state.opacity,
  };
  if (state.background !== undefined) {
    // uikit's `backgroundColor` takes an `[r, g, b, a]` tuple as well as a colour, and that alpha
    // applies to the fill only — unlike `opacity`, which the element passes down to its children.
    const { r, g, b } = state.background;
    props.backgroundColor =
      state.backgroundOpacity < 1 ? [r, g, b, state.backgroundOpacity] : state.background;
  }
  if (state.borderColor !== undefined) props.borderColor = state.borderColor;
  if (state.color !== undefined) props.color = state.color;
  if (state.fontSize !== undefined) props.fontSize = state.fontSize;
  if (state.fontWeight !== undefined) props.fontWeight = state.fontWeight;
  if (state.textAlign !== undefined) props.textAlign = state.textAlign;
  if (state.text !== undefined) props.text = state.text;
  if (state.src !== undefined) props.src = state.src;

  const [ax, ay] = state.anchor ? ANCHORS[state.anchor] : [undefined, undefined];
  if (ax === undefined || ay === undefined) {
    // No anchor: the element flows, and the parent's `layout` places it.
    if (state.width !== undefined) props.width = state.width;
    if (state.height !== undefined) props.height = state.height;
    return props;
  }

  // Anchored: out of the parent's flow, pinned by insets.
  props.positionType = 'absolute';
  inset(props, ax, state.x, 'Left', 'Right', state.width ?? measured?.[0]);
  inset(props, ay, state.y, 'Top', 'Bottom', state.height ?? measured?.[1]);
  if (ax !== 'stretch' && state.width !== undefined) props.width = state.width;
  if (ay !== 'stretch' && state.height !== undefined) props.height = state.height;
  return props;
}

/**
 * Pin one axis.
 *
 * A centred axis is the one CSS would do with `auto` margins between two insets — and yoga, which
 * lays uikit out, ignores auto margins on an absolutely positioned box: every `center`, `top` and
 * `left` landed in the top-left corner. So it is Unity's arithmetic instead: the anchor at 50% of
 * the parent, pulled back by half the element's own size, plus the offset.
 *
 * With no size written, the element is sized by its content, and the half comes from the size
 * layout gave it — `centreBySize` feeds that back, so a dialog of a title and a button centres
 * without anyone measuring it.
 */
function inset(
  props: Record<string, unknown>,
  mode: 'left' | 'center' | 'right' | 'stretch' | 'top' | 'middle' | 'bottom',
  offset: number,
  near: 'Left' | 'Top',
  far: 'Right' | 'Bottom',
  size: number | undefined,
): void {
  if (mode === 'left' || mode === 'top') {
    props[`position${near}`] = offset;
    return;
  }
  if (mode === 'right' || mode === 'bottom') {
    props[`position${far}`] = offset;
    return;
  }
  if (mode === 'stretch') {
    props[`position${near}`] = offset;
    props[`position${far}`] = offset;
    return;
  }
  props[`position${near}`] = '50%';
  props[`margin${near}`] = offset - (size ?? 0) / 2;
}

/**
 * Whether an element is centred on an axis it has no written size for — the ones whose size
 * layout has to tell us before they can be centred.
 */
export function centredBySize(state: RectState): boolean {
  const [ax, ay] = state.anchor ? ANCHORS[state.anchor] : [undefined, undefined];
  return (ax === 'center' && state.width === undefined) || (ay === 'middle' && state.height === undefined);
}

/**
 * Record the size layout gave a content-sized, centred element; true when that moved it, so the
 * caller lays out once more and nothing is drawn off-centre for a frame.
 */
export function centreBySize(element: UikitComponent): boolean {
  const state = rectStateOf(element);
  if (!centredBySize(state)) return false;
  const size = (element as unknown as { size: { peek(): [number, number] | undefined } }).size.peek();
  if (!size) return false;
  const layout = layoutStateOf(element);
  const [w, h] = layout.measured ?? [NaN, NaN];
  if (Math.abs(w - size[0]) < 0.5 && Math.abs(h - size[1]) < 0.5) return false;
  layout.measured = [size[0], size[1]];
  applyRect(element);
  return true;
}

/**
 * Install the accessors on uikit's base class.
 *
 * Each one stores into the element's state and re-applies the whole set, so assigning from a
 * document and assigning from game code (`this.score.text = 'SCORE 12'`) are the same path — and
 * there is no separate "commit" anyone has to remember.
 */
function defineRectAccessors(): void {
  const proto = UikitComponent.prototype as unknown as Record<string, unknown>;
  const keys: Array<keyof RectState> = [
    'anchor', 'x', 'y', 'width', 'height',
    'layout', 'alignX', 'alignY', 'gap', 'padding',
    'background', 'radius', 'border', 'borderColor', 'opacity', 'backgroundOpacity',
    'color', 'fontSize', 'fontWeight', 'textAlign',
  ];
  for (const key of keys) {
    Object.defineProperty(proto, key, {
      configurable: true,
      get(this: UikitComponent) {
        return rectStateOf(this)[key];
      },
      set(this: UikitComponent, value: never) {
        rectStateOf(this)[key] = value;
        applyRect(this);
      },
    });
  }
  Object.defineProperty(proto, '_rect', {
    configurable: true,
    get(this: UikitComponent) {
      return rectStateOf(this);
    },
  });
}

defineRectAccessors();

/**
 * Adding or removing a child is uikit's business too.
 *
 * uikit does not override these; it listens for them, and what it recomputes when the tree
 * changes includes the traversal flag it keeps in three's `visible`. Without this, an author's
 * `visible` on a panel would be undone by its own first child arriving.
 */
function guardTreeChanges(): void {
  const proto = UikitComponent.prototype;
  const add = proto.add;
  const remove = proto.remove;
  proto.add = function (this: UikitComponent, ...children) {
    return asUikit(() => add.apply(this, children));
  };
  proto.remove = function (this: UikitComponent, ...children) {
    return asUikit(() => remove.apply(this, children));
  };
}

guardTreeChanges();

/**
 * Run `then` once `object` is part of a loaded scene, however many steps that takes.
 *
 * A UI root has to reach its scene to ask for the system that draws it, and it cannot do that in
 * a constructor — a document builds an element before adding it, and a prefab builds its whole
 * subtree detached. three.js's `added` event is the signal; walking up from it finds the scene
 * when there is one, and re-arming on the topmost ancestor covers the case where there is not
 * yet.
 */
export function whenInScene(object: Object3D, then: (scene: Scene) => void): void {
  const attempt = (): void => {
    const scene = sceneOf(object);
    if (scene) {
      then(scene);
      return;
    }
    // Not there yet: the subtree is still detached, so wait for whatever it hangs from to be
    // added, and look again.
    const top = topOf(object);
    top.addEventListener('added', once);
  };
  const once = (): void => {
    topOf(object).removeEventListener('added', once);
    attempt();
  };
  object.addEventListener('added', once);
}

function sceneOf(object: Object3D): Scene | null {
  for (let node: Object3D | null = object; node; node = node.parent) {
    if ((node as Partial<Scene>).isScene) return node as Scene;
  }
  return null;
}

function topOf(object: Object3D): Object3D {
  let node = object;
  while (node.parent) node = node.parent;
  return node;
}
