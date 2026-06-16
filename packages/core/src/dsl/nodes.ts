// Compatibility shim. The node system moved to an extensible registry in
// `core/NodeRegistry.ts`, with built-ins split one-per-file under `nodes/**`.
// This module re-exports the registry surface (so existing `from './nodes.js'`
// import sites keep working).
//
// It deliberately does NOT import the built-in barrel: keeping the runtime entry
// node-module-free is what lets bundlers tree-shake unused node tags. Built-ins
// register on demand — the Vite plugin emits a usage-based import per used tag
// (see nodes/manifest.ts), or import `@scenoco-three/core/nodes` to register all.

export * from '../core/NodeRegistry.js';

