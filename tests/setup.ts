// Drop browser-console banners from the test log. A library may greet its user
// with `console.log('%c …', 'font-size: 14px')` at module scope (three.quarks
// does); the `%c` directive is a *devtools* CSS instruction, so such a line is
// addressed to a browser console, not to this terminal — and importing the
// package in a test would otherwise print it once per test file. Keyed on the
// format, never on a package or a message, so a real warning still shows.
// The tooling path applies the same rule when it imports tag packages
// (`importQuietly` in compiler/src/components.ts).
const consoleLog = console.log;
console.log = (...args: unknown[]): void => {
  if (typeof args[0] === 'string' && args[0].startsWith('%c')) return;
  consoleLog(...args);
};

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
