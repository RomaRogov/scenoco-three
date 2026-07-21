/**
 * The single import point for `@pmndrs/uikit` — every other file in this package
 * (and every consumer) reaches uikit through here.
 *
 * All uikit classes keep their own well-known names (`Container`, `Text`,
 * `Image`, `Fullscreen`), so runtime code reads exactly like the uikit docs. The
 * one exception is uikit's base class `Component`, which collides with SceNoCo's
 * `Component` (the MonoBehaviour-style script base): it is re-exported as
 * `UiKitComponent`. It is the layout-engine base class — game code almost never
 * touches it; the engine uses it to recognise "this Object3D is a UI element".
 */
export {
  Component as UiKitComponent,
  Container,
  Text,
  Image,
  Fullscreen,
  reversePainterSortStable,
} from '@pmndrs/uikit';
