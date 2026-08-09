// Lets `tsc` accept a component importing another scene/prefab as a bundle (the
// Vite plugin supplies the compiled Bundle at build time). Mirrors the
// `vite-env.d.ts` that `scenoco init` scaffolds into a project.
declare module '*.xml?bundle' {
  const bundle: import('@scenoco-three/core').Bundle;
  export default bundle;
}
