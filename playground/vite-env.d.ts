/// <reference types="vite/client" />

declare module '*.xml?raw' {
  const content: string;
  export default content;
}

declare module '*.xml?bundle' {
  const bundle: import('@scenoco-three/core').Bundle;
  export default bundle;
}
