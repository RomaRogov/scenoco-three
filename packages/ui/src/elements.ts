import type { Texture, WebGLRenderer } from 'three';
import {
  Container,
  Fullscreen,
  Image as UikitImage,
  Text as UikitText,
} from '@pmndrs/uikit';
import { UIRenderer } from './UIRenderer.js';
import { applyRect, ownVisible, rectStateOf, whenInScene } from './rect.js';

/**
 * Join the scene's UI renderer as soon as this element is in a loaded scene.
 *
 * Only a **root** needs it — an element whose parent is not itself a UI element — because uikit
 * lays a whole tree out from its root. Every element asks anyway and the system sorts it out,
 * which costs one call at load and saves the document from having to say which one is the root.
 */
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
 *   <Canvas padding="24">
 *     <Panel anchor="stretchTop" height="64" background="#111827" layout="horizontal"
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
 */
export class Canvas extends Fullscreen {
  constructor() {
    // uikit wants the renderer at construction and only ever reads it in `update`, and a
    // document has no renderer to give. `UIRenderer` injects the engine's before the first
    // frame — see its `update`.
    super(undefined as unknown as WebGLRenderer);
    joinRenderer(this);
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

  /** The picture to draw. */
  get src(): Texture | undefined {
    return rectStateOf(this).src;
  }

  set src(value: Texture | undefined) {
    rectStateOf(this).src = value;
    applyRect(this);
  }
}
