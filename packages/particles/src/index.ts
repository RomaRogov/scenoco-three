// `@scenoco-three/particles` — particle systems / VFX for SceNoCo, built on
// three.quarks (a batched, general-purpose particle engine for three.js).
//
//   • `<ParticleSystem>` — a component with Unity Shuriken-style settings. Author
//     it inline (flat Main/Emission/Shape/Renderer props) or point `src=` at a
//     `.particle.xml` file (its own grammar + XSD, with over-lifetime modules) or
//     a `.quarks.json` exported from the quarks.art editor.
//   • `ParticleRenderSystem` — the `@system` that owns the scene's single
//     three.quarks `BatchedRenderer`, builds a system per component, and steps
//     it each frame. Auto-runs when the scene has a `<ParticleSystem>` (the
//     System seam, like the physics add-ons) and, like them, only in play mode.
//
// Importing this module registers the component and the particle enums (decorator
// + enumOf side effects), hence the package is `sideEffects`.
//
// It deliberately does NOT reach the `.particle.xml` compiler: that is build-time
// code, and importing it here would pin it — and its diagnostic strings — into
// every game bundle (invariant 2). It lives behind the separate
// `@scenoco-three/particles/compiler` entry, which only `scenoco` loads.

export { ParticleSystem } from './ParticleSystem.js';
export { ParticleRenderSystem } from './ParticleRenderSystem.js';
export { configToParameters, type ParticleConfig } from './config.js';
export { ParticleShape, ParticleRenderMode, SimulationSpace, ParticleBlending } from './enums.js';

/** The tags this package registers — for the compiler/Vite `registerPackages`. */
export const sceneTags = ['ParticleSystem'] as const;

/**
 * Package-owned XSDs for this package's `src=` document formats, shipped at the
 * package root (see package.json `files`). `scenoco export` copies them into the
 * project's schema dir so a `.particle.xml` can wire IDE validation via
 * `xsi:noNamespaceSchemaLocation="particle.xsd"`. Plain filenames (never loaded
 * at runtime) — the CLI resolves them against this package's directory.
 */
export const schemas = ['particle.xsd'] as const;

/**
 * This package ships a build-time entry (`@scenoco-three/particles/compiler`)
 * describing its `src=` document format. A plain boolean, so the compiler knows
 * to load that subpath without probing for a module that may not exist.
 */
export const hasSrcDocument = true;
