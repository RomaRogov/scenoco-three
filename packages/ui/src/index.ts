// `@scenoco-three/ui` — in-canvas UI for SceNoCo, built on pmndrs uikit (a
// flexbox layout + MSDF text + panel renderer where every element is a real
// THREE.Mesh).
//
//   • `<Fullscreen>` — screen-space UI root, a child of the camera node; always
//     fills the viewport, children are laid out in screen pixels.
//   • `<Container>` / `<Text>` / `<Image>` — uikit elements as ordinary scene
//     nodes; attributes are uikit property names/values verbatim. A `<Container>`
//     outside any UI parent is a world-space UI root, placed with the usual
//     transform attributes.
//   • `UIRenderSystem` — the `@system` that applies uikit's renderer settings
//     and updates each UI root once per frame. Auto-runs when the scene has a
//     UI element (node-query System seam), in the editor too (`executeInEditor`).
//
// Runtime code drives elements with the plain uikit API, e.g.
//   this.label.setProperties({ text: `SCORE ${score}` })
// — `Container`/`Text`/`Image`/`Fullscreen` re-export from uikit under their own
// names. Only uikit's base class `Component` is renamed (`UiKitComponent`), to
// keep SceNoCo's `Component` unambiguous.
//
// Importing this module registers the node tags, enums, and system (decorator
// side effects), hence the package is `sideEffects`.

export { UiKitComponent, Container, Text, Image, Fullscreen, reversePainterSortStable } from './uikit.js';
export { UIElementNode } from './nodes/UIElementNode.js';
export { ContainerNode } from './nodes/Container.js';
export { FullscreenNode } from './nodes/Fullscreen.js';
export { TextNode } from './nodes/Text.js';
export { ImageNode } from './nodes/Image.js';
export { UIRenderSystem } from './UIRenderSystem.js';
export {
  FlexDirection,
  FlexWrap,
  JustifyContent,
  AlignItems,
  AlignSelf,
  PositionType,
  Overflow,
  Display,
  TextAlign,
  VerticalAlign,
  ObjectFit,
  PointerEvents,
} from './enums.js';

/** The tags this package registers — for the compiler/Vite `registerPackages`. */
export const sceneTags = ['Fullscreen', 'Container', 'Text', 'Image'] as const;
