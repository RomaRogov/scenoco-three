# @scenoco-three/ui

In-canvas UI for [SceNoCo](https://github.com/RomaRogov/scenoco-three), on
[pmndrs uikit](https://pmndrs.github.io/uikit): MSDF text and panels where **every element is a
real `THREE.Mesh`**, so UI elements are ordinary scene nodes — they nest in the tree, carry
`<Components>`, are referenced by `#id` like any node, and show up in the editor and in the
observer's `outline`.

Placement is **Unity's RectTransform**, not CSS: an anchor preset, an offset, a size. Four tags,
nineteen attributes, and none of them is a flexbox property.

```xml
<PerspectiveCamera id="camera" position="y: 9; z: 6">
  <!-- The screen-space root. A child of the camera, always; it fills the viewport, and its
       children are laid out in screen pixels. -->
  <Canvas id="hud">
    <Panel anchor="stretchTop" x="20" y="20" height="56" background="#0f172a" layout="horizontal"
           alignY="center" gap="28" padding="16">
      <Text id="scoreText" text="SCORE 0" fontSize="20" color="#ffffff" />
      <Text id="timeText" text="TIME 45" fontSize="20" color="#ffffff" />
    </Panel>
    <Panel anchor="center" width="360" height="80" layout="vertical" alignX="center" alignY="center">
      <Text id="banner" text="" fontSize="30" fontWeight="bold" color="#f87171" textAlign="center" />
    </Panel>
    <Components>
      <Hud scoreText="#scoreText" timeText="#timeText" banner="#banner" />
    </Components>
  </Canvas>
</PerspectiveCamera>
```

```ts
import { Component } from '@scenoco-three/core';
import type { Text } from '@scenoco-three/ui';

/** A field typed `Text` is a slot the document fills with `#id`; `text` is a plain property. */
export class Hud extends Component {
  scoreText!: Text;
  timeText!: Text;
  banner!: Text;

  override update(): void {
    this.scoreText.text = `SCORE ${this.game.score}`;
  }
}
```

## Tags

| Tag | Is | Notes |
| --- | --- | --- |
| `<Canvas>` | the screen-space root | **A child of the camera node.** Fills the viewport. One per camera. |
| `<Panel>` | a rectangle that holds and lays out others | Outside a `<Canvas>` it is a world-space panel, placed with `position` / `eulerAngles` / `scale` like any node. |
| `<Text>` | a run of text | `text`, `fontSize`, `fontWeight` (`normal` / `bold`), `color`, `textAlign` (`left` / `center` / `right`). Inherited from the element above, the way CSS inherits font. |
| `<Image>` | a picture | `src` names an image file, exactly as a material's `map` does. |
| `<Button />` | a component that makes its element clickable | Put it in the element's `<Components>`; `onClick` is a typed event, `interactable` switches it off. |

## Placement

| Attribute | Meaning |
| --- | --- |
| `anchor` | Where in the parent the element hangs: `topLeft`, `top`, `topRight`, `left`, `center`, `right`, `bottomLeft`, `bottom`, `bottomRight`, or a stretch — `stretchTop`, `stretchBottom`, `stretchLeft`, `stretchRight`, `stretch`. Omit it to take the parent's `layout`. |
| `x`, `y` | Offset from the anchor, in pixels — on a stretched axis, the inset from both edges. |
| `width`, `height` | Size in pixels. A stretched axis takes the parent's; left off, the element is as big as what it holds. |
| `layout` | How children line up: `vertical` (default) or `horizontal`. |
| `alignX`, `alignY` | Where children sit on each axis — `start`, `center`, `end`, `stretch`, `between`. Always horizontal and always vertical, whichever way `layout` runs. |
| `gap`, `padding` | Between children, and inside the edges, in pixels. Only for children the `layout` places: an anchored child is pinned to the edge itself, so its `x`/`y` are its margin. |
| `background`, `backgroundOpacity` | Fill colour (`#rrggbb`) and the fill's own opacity — the HUD bar CSS writes as `#0f172acc`. A `THREE.Color` has no alpha channel, so the transparency is its own number. |
| `opacity` | The whole element, **inherited**: it fades this element's text and children with it. For a translucent bar behind readable text, use `backgroundOpacity`. |
| `radius`, `border`, `borderColor` | Corner radius and border, in pixels. |

Values read back — in the editor, in `telemetry` — in the same vocabulary.

## Gotchas

- **The font ships ASCII only.** uikit's default MSDF font is Inter's basic Latin set; a glyph it
  does not have (an em dash, an arrow, most accents) draws as a small box. Use `-`, not `—`.
- **A `<Canvas>` that is not under a camera is not on screen.** It is a child of the camera on
  purpose — that is what puts it where the player sees it.
- The compiler accepts `position` on a UI element, since every node has one; inside a `<Canvas>`
  it does nothing, because layout owns the transform. Use `anchor` / `x` / `y`.

## License

MIT
