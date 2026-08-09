/// <reference types="vite/client" />

// The Vite plugin (@scenoco-three/vite) compiles `?bundle` imports of a scene or
// a prefab to a runtime Bundle at build time — the browser ships no XML parser.
declare module '*.xml?bundle' {
  const bundle: import('@scenoco-three/core').Bundle;
  export default bundle;
}
