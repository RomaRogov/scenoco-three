/// <reference types="vite/client" />

// The Vite plugin (@scenoco-three/vite) compiles `*.scene.xml?bundle` imports to
// a runtime Bundle at build time — the browser ships no XML parser.
declare module '*.scene.xml?bundle' {
  const bundle: import('@scenoco-three/core').Bundle;
  export default bundle;
}
