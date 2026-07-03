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
// Importing this module registers the component, the particle enums, and the
// `.particle.xml` src-compiler (decorator + enumOf + registerSrcCompiler side
// effects), hence the package is `sideEffects`.
import { registerSrcCompiler } from '@scenoco-three/core';
import { compileParticleDocument } from './compileDocument.js';

// The core compiler delegates a `<ParticleSystem src="*.particle.xml">` document to this.
registerSrcCompiler('ParticleSystem', compileParticleDocument);

export { ParticleSystem } from './ParticleSystem.js';
export { ParticleRenderSystem } from './ParticleRenderSystem.js';
export { compileParticleDocument } from './compileDocument.js';
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
