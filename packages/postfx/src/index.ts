/**
 * `@scenoco-three/postfx` — how a frame is drawn.
 *
 * The tags a `*.render.xml` document is written from. Each is an `Effect`: a class whose public
 * fields are its attributes, exactly like a component's, and which either configures the
 * renderer (`apply`) or contributes a post-processing pass (`createPass`).
 *
 * ```xml
 * <!-- assets/render/neon.render.xml -->
 * <Render>
 *   <ToneMapping curve="ACESFilmicToneMapping" exposure="1.05" />
 *   <Shadows />
 *   <Bloom strength="0.75" threshold="0.72" />
 * </Render>
 * ```
 *
 * ```xml
 * <Scene render="../render/neon.render.xml"> … </Scene>
 * ```
 *
 * A scene that names no render document gets three.js's defaults, and a project that never
 * writes one never loads the postprocessing addons.
 */
export { ToneMapping } from './ToneMapping.js';
export { Shadows } from './Shadows.js';
export { Bloom } from './Bloom.js';
export { Vignette } from './Vignette.js';
