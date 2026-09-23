import { Object3D, type Texture, type WebGLRenderer } from 'three';
import {
  Component as UikitComponent,
  Container,
  Fullscreen,
  Image as UikitImage,
  Text as UikitText,
} from '@pmndrs/uikit';
import { CameraFit } from '@scenoco-three/core';
import { UIRenderer } from './UIRenderer.js';
import { applyRect, ownVisible, rectStateOf, whenInScene } from './rect.js';

/**
 * Join the scene's UI renderer as soon as this element is in a loaded scene.
 *
 * Only a **root** needs it — an element whose parent is not itself a UI element — because uikit
 * lays a whole tree out from its root. Every element asks anyway and the system sorts it out,
 * which costs one call at load and saves the document from having to say which one is the root.
 */
/**
 * A copy of a UI element, for `clone()` and `instantiate`: the same class, what was authored on
 * it, its components, and its elements below.
 *
 * uikit's own `clone` builds a bare uikit class and copies the transform only — no components, no
 * authored size or text — and its `copy` refuses outright. So the node itself goes through
 * three's `copy`, which core extends to carry components, one level at a time.
 */
function cloneElement<T extends UikitComponent>(source: T, recursive: boolean | undefined): T {
  const copy = new (source.constructor as new () => T)();
  Object3D.prototype.copy.call(copy, source, false);
  const from = rectStateOf(source) as unknown as Record<string, unknown>;
  const to = rectStateOf(copy) as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(from)) {
    const own = value as { clone?: () => unknown; isTexture?: boolean } | undefined;
    // A colour is a value and gets its own; a texture is an asset and is shared.
    to[key] = own && typeof own.clone === 'function' && !own.isTexture ? own.clone() : value;
  }
  applyRect(copy);
  if (recursive !== false) {
    for (const child of source.children) {
      // uikit's instanced meshes are the root's drawing machinery, rebuilt by the copy's own root.
      if (child instanceof UikitComponent) copy.add(child.clone(true));
    }
  }
  return copy;
}

function joinRenderer(element: Container | Fullscreen | UikitText | UikitImage): void {
  // An `<Image>` draws through a mesh of its own; everything else is painted by the root's
  // shared instanced panel, which is the distinction `ownVisible` needs.
  ownVisible(element, element instanceof UikitImage);
  whenInScene(element, (scene) => {
    scene.requireSystem(UIRenderer).add(element);
  });
  // Nothing was authored on a freshly-constructed element, so this is what puts the defaults —
  // the flex direction, the alignment — onto uikit before the first frame.
  applyRect(element);
}

/**
 * The screen-space UI root — Unity's `Canvas`.
 *
 * ```xml
 * <PerspectiveCamera id="cam" position="z: 10">
 *   <Canvas>
 *     <Panel anchor="stretchTop" x="24" y="24" height="64" background="#111827" layout="horizontal"
 *            alignY="center" gap="12" padding="16">
 *       <Text text="SCORE 0" id="score" fontSize="20" color="#ffffff" />
 *     </Panel>
 *   </Canvas>
 * </PerspectiveCamera>
 * ```
 *
 * It fills the viewport and lays its children out in **pixels**, so a document says `height="64"`
 * and means 64 screen pixels. It must be a child of the camera node, which is where a Unity
 * Canvas in Screen Space – Camera mode lives too.
 *
 * For UI that exists in the world — a health bar over a character, a screen on a wall — use a
 * `<Panel>` on its own instead and place it with the ordinary transform attributes.
 *
 * @parent camera
 * @tip A Canvas fills the view of the camera it hangs off, in screen pixels: put it inside the
 * camera the scene is seen through, <Scene camera="#cam"> … <PerspectiveCamera id="cam"><Canvas>.
 */
export class Canvas extends Fullscreen {
  constructor() {
    // uikit wants the renderer at construction and only ever reads it in `update`, and a
    // document has no renderer to give. `UIRenderer` injects the engine's before the first
    // frame — see its `update`.
    super(undefined as unknown as WebGLRenderer);
    joinRenderer(this);
  }

  /**
   * Fill the screen — or, under a camera that keeps a frame whole with `<CameraFit>`, fill that
   * frame.
   *
   * Unity's canvas does the same against a camera's viewport rect.
   *
   * The world outside a `contain` frame is only there because the window has a different shape;
   * a HUD laid out against it put its corners where the game is not. So the root shrinks to the
   * frame, centred, and every anchor inside it means the frame's edge. Pixels stay pixels.
   */
  override update(delta: number): void {
    super.update(delta);
    // What uikit just measured: the whole frustum at the UI's depth. Its own signals, private in
    // its types — read, never written, because they are rewritten every frame from the camera.
    const { sizeX, sizeY } = this as unknown as { sizeX: { peek(): number }; sizeY: { peek(): number } };
    const width = sizeX.peek();
    const height = sizeY.peek();
    const aspect = this.parent?.getComponent(CameraFit)?.frameAspect;
    let box: { sizeX?: number; sizeY?: number } = {};
    if (aspect && width > 0 && height > 0) {
      box = width / height > aspect ? { sizeX: height * aspect } : { sizeY: width / aspect };
    }
    // Set as properties, which win over the measured defaults — and only when they change, so a
    // steady window lays nothing out again.
    if (box.sizeX === this.boxed.sizeX && box.sizeY === this.boxed.sizeY) return;
    this.boxed = box;
    (this as unknown as { setProperties(p: Record<string, unknown>): void }).setProperties({
      sizeX: box.sizeX,
      sizeY: box.sizeY,
    });
  }

  /** The frame the root is held to, if any — see {@link update}. */
  private boxed: { sizeX?: number; sizeY?: number } = {};

  override clone(recursive?: boolean): this {
    return cloneElement(this, recursive);
  }
}

/**
 * A rectangle that holds and lays out other elements — Unity's `Panel`.
 *
 * ```xml
 * <Panel anchor="center" width="360" height="220" background="#1f2937" radius="12"
 *        layout="vertical" alignX="center" alignY="center" gap="16" padding="24">
 *   <Text text="Paused" fontSize="32" color="#ffffff" />
 *   <Panel width="200" height="44" background="#2563eb" radius="8" />
 * </Panel>
 * ```
 *
 * On its own, outside a `<Canvas>`, it is world-space UI: an ordinary node placed with
 * `position`, `eulerAngles` and `scale` like anything else in the scene.
 */
export class Panel extends Container {
  constructor() {
    super();
    joinRenderer(this);
  }

  override clone(recursive?: boolean): this {
    return cloneElement(this, recursive);
  }
}

/**
 * A run of text — Unity's `Text`.
 *
 * ```xml
 * <Text text="SCORE 0" fontSize="20" color="#ffffff" textAlign="center" />
 * ```
 *
 * ```ts
 * class Scoreboard extends Component {
 *   label!: Text;
 *   private set score(value: number) { this.label.text = `SCORE ${value}`; }
 * }
 * ```
 *
 * `color`, `fontSize`, `fontWeight` and `textAlign` are inherited from any element above, the way
 * CSS inherits them — so a panel can style every label inside it at once.
 */
export class Text extends UikitText {
  constructor() {
    super();
    joinRenderer(this);
  }

  override clone(recursive?: boolean): this {
    return cloneElement(this, recursive);
  }

  /** What it says. */
  get text(): string {
    return rectStateOf(this).text ?? '';
  }

  set text(value: string) {
    rectStateOf(this).text = value;
    applyRect(this);
  }
}

/**
 * A picture — Unity's `Image`.
 *
 * ```xml
 * <Image src="../textures/logo.png" width="128" height="128" anchor="topRight" x="24" y="24" />
 * ```
 *
 * `src` is declared `Texture`, so it names an image file exactly the way a material's `map` does,
 * and the same file used by both is one texture.
 */
export class Image extends UikitImage {
  constructor() {
    super();
    joinRenderer(this);
  }

  override clone(recursive?: boolean): this {
    return cloneElement(this, recursive);
  }

  /** The picture to draw. */
  get src(): Texture | undefined {
    return rectStateOf(this).src;
  }

  set src(value: Texture | undefined) {
    rectStateOf(this).src = value;
    applyRect(this);
  }
}
