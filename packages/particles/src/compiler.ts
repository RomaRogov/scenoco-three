// Build-time entry: `@scenoco-three/particles/compiler`.
//
// Everything here runs in Node, during a build — never in a game bundle. That is
// the whole point of the split: the runtime entry (`./index.js`) registers the
// component and the renderer system, and nothing else, so a browser build never
// pulls in the `.particle.xml` document compiler or this starter template.
//
// `scenoco` discovers this module by convention (`<pkg>/compiler`) when it
// registers tag packages, and reads the `srcDocument` export below. From that one
// description it drives `scenoco new particle`, `scenoco validate *.particle.xml`,
// and the `src=` resolution inside a scene — the format is declared once.
//
// The `SrcDocumentDef` import is type-only, so it erases at build: this package
// keeps @scenoco-three/compiler as a devDependency and gains no runtime edge.
import type { SrcDocumentDef } from '@scenoco-three/compiler';
import { compileParticleDocument } from './compileDocument.js';

/**
 * The starter `.particle.xml` — a small but complete burst, so a fresh file
 * renders something the first time it is used, rather than needing a module
 * added before it does anything visible.
 */
function template(name: string): string {
  return `<!-- ${name}: a short one-shot burst. Point a component at it with
     <ParticleSystem src="../vfx/${name}.particle.xml" />. -->
<ParticleSystem xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                xsi:noNamespaceSchemaLocation="../../schema/particle.xsd"
                duration="1" looping="false" simulationSpace="World"
                startLifetime="0.8" startSpeed="2" startSize="0.15" startColor="#ffffff">
  <Emission rateOverTime="0">
    <Burst time="0" count="24" />
  </Emission>
  <Shape type="Sphere" radius="0.2" />
  <Renderer renderMode="Billboard" blending="Additive" />
  <SizeOverLifetime curve="[1, 0.6, 0]" />
</ParticleSystem>
`;
}

/** The `.particle.xml` format, owned entirely by this package. */
export const srcDocument: SrcDocumentDef = {
  component: 'ParticleSystem',
  extension: '.particle.xml',
  root: 'ParticleSystem',
  description: 'A particle system / VFX document (Unity Shuriken-style modules)',
  dir: 'assets/vfx',
  compile: compileParticleDocument,
  template,
};

export { compileParticleDocument } from './compileDocument.js';
