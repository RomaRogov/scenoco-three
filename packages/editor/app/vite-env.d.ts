/// <reference types="vite/client" />

// The editor server's plugin emits two modules: `scenoco-runtime` registers the
// built-in node tags + tag packages, and `scenoco-components` imports every project
// component. They're split so a broken component can't wipe the core tag registry.
declare module 'virtual:scenoco-runtime';
declare module 'virtual:scenoco-components';
