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
    /** Width in pixels. Leave it off on a stretched axis — the stretch is the width. */
    width?: number;
    /** Height in pixels. Leave it off on a stretched axis. */
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
    /** Space inside the element's own edges, in pixels. */
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
    /** `0`..`1`. Inherited, so it fades this element's text and children with it. */
    opacity: number;

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
  color?: Color;
  fontSize?: number;
  fontWeight?: FontWeight;
  textAlign?: TextAlign;
  /** `<Text>` only. */
  text?: string;
  /** `<Image>` only. */
  src?: Texture;
}

function freshState(): RectState {
  return {
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
  };
}

const states = new WeakMap<object, RectState>();

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
  const props = toUikitProperties(rectStateOf(element));
  // `setActive(false)` is how everything else in the engine hides a node, and on a UI element it
  // did nothing at all: core sets `visible`, while uikit decides what to draw from `display` and
  // paints every panel through one shared instanced mesh that never looks at a container's
  // `visible` flag. A "hidden" full-screen panel therefore kept drawing — and since a `<Canvas>`
  // sits in front of the camera, an 82%-opaque one dimmed the entire game to a fifth of its
  // brightness with no way to tell from the scene graph that anything was wrong.
  // Written both ways round, never omitted: `setProperties` merges, so a `display: 'none'` left
  // from an inactive moment would stick for ever once the element became active again.
  const active = (element as unknown as { activeInHierarchy?: boolean }).activeInHierarchy !== false;
  props.display = active ? 'flex' : 'none';
  (element as unknown as { setProperties(p: Record<string, unknown>): void }).setProperties(props);
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
export function toUikitProperties(state: RectState): Record<string, unknown> {
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
  if (state.background !== undefined) props.backgroundColor = state.background;
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
  inset(props, ax, state.x, 'Left', 'Right');
  inset(props, ay, state.y, 'Top', 'Bottom');
  if (ax !== 'stretch' && state.width !== undefined) props.width = state.width;
  if (ay !== 'stretch' && state.height !== undefined) props.height = state.height;
  return props;
}

/**
 * Pin one axis.
 *
 * Centring uses `auto` margins between two insets, which is how CSS centres an absolutely
 * positioned box without knowing its size — and it keeps the offset meaningful: the box centres
 * within `[near, far]`, so doubling the near inset shifts the centre by exactly the offset.
 */
function inset(
  props: Record<string, unknown>,
  mode: 'left' | 'center' | 'right' | 'stretch' | 'top' | 'middle' | 'bottom',
  offset: number,
  near: 'Left' | 'Top',
  far: 'Right' | 'Bottom',
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
  // Centred, with the offset folded into the near or far inset.
  props[`position${near}`] = offset >= 0 ? offset * 2 : 0;
  props[`position${far}`] = offset >= 0 ? 0 : offset * -2;
  props[`margin${near}`] = 'auto';
  props[`margin${far}`] = 'auto';
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
    'background', 'radius', 'border', 'borderColor', 'opacity',
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
