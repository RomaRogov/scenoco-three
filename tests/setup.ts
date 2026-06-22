// Vitest setup. Register all built-in node tags — the runtime entry
// (@scenoco-three/core) intentionally ships zero node modules so bundlers can
// tree-shake; in an app the Vite plugin imports the used ones per scene, and in
// Node tooling the compiler imports this barrel. Tests want them all available.
import '@scenoco-three/core/nodes';

// Register the demo components the test fixtures (turbine scene, reference
// tests) rely on. In an app the Vite plugin imports the components each scene
// uses; the CLI loads them via --components.
import './fixtures/components/Rotator.js';
import './fixtures/components/Oscillator.js';
import './fixtures/components/Follow.js';
import './fixtures/components/LookAt.js';
import './fixtures/components/ArrayProbe.js';
