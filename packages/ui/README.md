# @scenoco-three/ui

In-canvas UI for [SceNoCo](https://github.com/RomaRogov/scenoco-three), built on
[pmndrs uikit](https://pmndrs.github.io/uikit) — flexbox layout, MSDF text, and
panel rendering where **every element is a real `THREE.Mesh`**. That makes UI
elements ordinary scene nodes: they nest in the scene tree, carry
`<Components>`, are referenced like any node, and show up in the editor's
hierarchy, inspector, and previews.

Attribute names and values are uikit properties **verbatim** — if you know uikit
or CSS flexbox, you already know the DSL.

```xml
<PerspectiveCamera id="cam" position="y: 7; z: 20" fov="45">
  <!-- Screen-space HUD: a child of the camera (uikit's convention), always
       fills the viewport; children are laid out in screen pixels. -->
  <Fullscreen id="hud" color="#e2e8f0" fontWeight="bold">
    <Container width="100%" flexDirection="row" justifyContent="space-between" padding="20">
      <Container flexDirection="row" gap="8" padding="10">
        <!-- `opacity` is inherited (it would fade the text too), so a translucent
             panel is its own element behind fully-opaque content. -->
        <Container positionType="absolute" positionTop="0" positionRight="0" positionBottom="0" positionLeft="0"
                   backgroundColor="#0a0e16" opacity="0.7" borderRadius="10" />
        <Text text="SCORE" fontSize="26" />
        <Text id="score" text="0" fontSize="26" color="#4af0e0" />
      </Container>
    </Container>
    <Components><Scoreboard scoreLabel="#score" /></Components>
  </Fullscreen>
</PerspectiveCamera>
```

Drive elements from a normal component with node references and the plain uikit
API:

```ts
import { Component, component, property, ValueType } from '@scenoco-three/core';
import type { Text } from '@scenoco-three/ui';

@component({ name: 'Scoreboard', description: 'Updates the HUD score' })
export class Scoreboard extends Component {
  @property({ type: ValueType.Node, description: 'Text element showing the score' })
  scoreLabel: Text | null = null;

  addPoints(points: number): void {
    this.scoreLabel?.setProperties({ text: String(points) });
  }
}
```

## Tags

| Tag | uikit class | Notes |
| --- | --- | --- |
| `<Fullscreen>` | `Fullscreen` | Screen-space root; **must be a child of the camera node**. Children lay out in screen pixels. |
| `<Container>` | `Container` | Flexbox container (the UI `div`). Outside any UI parent it is a **world-space root**, placed with the usual transform attrs. |
| `<Text>` | `Text` | MSDF text (`text`, `fontSize`, `fontWeight`, `color`, `textAlign`, …). Text style props inherit through containers, like CSS. |
| `<Image>` | `Image` | Textured panel (`src` rides the asset pipeline, `objectFit`). |

Sizing/spacing attrs accept the CSS forms: a number (`width="250"`), a
percentage (`width="50%"`), or `auto`. Show/hide with `display="none"`.
Nested elements are positioned by flexbox — not by transform attributes.

## Interaction

- `pointerEvents="auto | none | listener"` (CSS semantics): an `auto` element
  blocks pointer rays, so a HUD panel over the game swallows clicks for
  gameplay raycasts too — Unity's "UI blocks scene clicks". `<Fullscreen>`
  itself defaults to `listener` (click-through where empty).
- SceNoCo's component pointer hooks work on UI nodes like on any mesh — a
  button is a `<Container id="btn">` plus a component whose
  `onPointerClick(e)` checks `e.object`'s ancestry.
- uikit hover/active states and scrolling run off the forwarded canvas events
  (`@pmndrs/pointer-events`), wired automatically by `UIRenderSystem`.

## Runtime

`UIRenderSystem` — registered `@system({ nodes: UiKitComponent, executeInEditor: true })`
— auto-runs whenever the scene contains a UI element. It applies uikit's
required renderer settings, injects the renderer into `Fullscreen` roots, and
calls `update(delta)` once per frame on each UI **root** (an element whose
parent is not itself a UI element). It runs in the editor too, so layout is
live while editing.

Only uikit's base class is renamed (`Component` → `UiKitComponent`, it collides
with SceNoCo's `Component`); everything else re-exports under its uikit name:
`Container`, `Text`, `Image`, `Fullscreen`.

## Gotchas

- Keep `three` deduped — two three copies in a bundler graph break `instanceof`
  and uikit silently stops sizing. The SceNoCo Vite plugin and editor already
  set `resolve.dedupe: ['three']`.
- MSDF text ships uikit's default Inter charset; exotic glyphs (`·`, emoji)
  warn and draw nothing — stick to ASCII or register `fontFamilies`.
