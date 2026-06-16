// Vitest setup. Register all built-in node tags — the runtime entry
// (@scenoco-three/core) intentionally ships zero node modules so bundlers can
// tree-shake; in an app the Vite plugin imports the used ones per scene, and in
// Node tooling the compiler imports this barrel. Tests want them all available.
import '@scenoco-three/core/nodes';

// Register the playground's demo components, which the test fixtures (turbine
// scene, reference tests) rely on. In an app the Vite plugin imports the
// components each scene uses; the CLI loads them via --components.
import '../playground/components/Rotator.js';
import '../playground/components/Oscillator.js';
import '../playground/components/Follow.js';
import '../playground/components/LookAt.js';
