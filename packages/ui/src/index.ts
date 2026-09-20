/**
 * `@scenoco-three/ui` — in-canvas UI for SceNoCo, on pmndrs uikit.
 *
 * ```xml
 * <PerspectiveCamera id="cam" position="z: 10">
 *   <Canvas>
 *     <Panel anchor="stretchTop" height="64" background="#111827"
 *            layout="horizontal" alignY="center" gap="12" padding="16">
 *       <Text id="score" text="SCORE 0" fontSize="20" color="#ffffff" />
 *     </Panel>
 *
 *     <Panel anchor="center" width="360" height="220" background="#1f2937" radius="12"
 *            layout="vertical" alignX="center" alignY="center" gap="16" padding="24">
 *       <Text text="Paused" fontSize="32" color="#ffffff" />
 *       <Image src="../textures/logo.png" width="96" height="96" />
 *     </Panel>
 *   </Canvas>
 * </PerspectiveCamera>
 * ```
 *
 * ## Placing things
 *
 * Every element takes the same five placement attributes, and they are Unity's RectTransform:
 *
 * | | |
 * | --- | --- |
 * | `anchor` | one of fourteen presets — `topLeft`, `center`, `stretchTop`, `stretch`, … |
 * | `x` `y` | pixels **in** from the anchored edge (an offset from centre at a centre anchor) |
 * | `width` `height` | pixels |
 *
 * Writing an `anchor` pins the element; leaving it off lets the parent's `layout` place it. A
 * stretched axis needs no size — the stretch *is* the size, and `x`/`y` become its inset.
 *
 * Children stack by `layout` (`vertical` or `horizontal`) and line up by `alignX` and `alignY` —
 * which always mean horizontally and vertically, whichever way the stack runs. CSS swaps
 * `justify-content` and `align-items` when the direction changes; nothing here does.
 *
 * Everything is a number, a colour, or a short enum. There are no CSS length strings, no
 * `flexGrow`/`flexBasis`/`alignSelf`, and no `positionType` — a rectangle either has a size or it
 * stretches, which is all Unity's RectTransform ever says either.
 *
 * ## The tags
 *
 * - **`Canvas`** — the screen-space root, a child of the camera node. Lays out in screen pixels.
 * - **`Panel`** — a rectangle that holds and lays out others. On its own, world-space UI.
 * - **`Text`** — a run of text. `color`, `fontSize`, `fontWeight` and `textAlign` are inherited.
 * - **`Image`** — a picture; `src` names an image file like a material's `map`.
 * - **`Button`** — a component that makes the element it sits on clickable, with an `onClick` event.
 * - **`UIRenderer`** — the system that lays them out. Optional: the first element creates one.
 *
 * Each is a real `THREE.Mesh`, so they are ordinary scene nodes: they nest, they carry
 * `<Components>`, and a component reaches one through an `id` like any other node.
 */
export { Canvas, Panel, Text, Image } from './elements.js';
export { UIRenderer } from './UIRenderer.js';
export { Button } from './Button.js';
export type { Align, Anchor, FontWeight, Layout, RectState, TextAlign } from './rect.js';
/**
 * What an element's authored values mean, as uikit properties.
 *
 * The mapping is the contract of this package — the anchor presets, the absolute `alignX`/`alignY`
 * axes, the pixel sizes — so it is exported rather than hidden: an editor previewing a layout and
 * a test asserting one should both be able to ask.
 */
export { toUikitProperties } from './rect.js';
