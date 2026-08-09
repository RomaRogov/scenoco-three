import { Component, component } from '@scenoco-three/core';

// Two module-scope logs, standing in for a third-party dependency that greets its
// user on import (three.quarks does exactly this). The `%c` one is a browser
// devtools instruction and must not reach a terminal; the plain one is a real
// message and must survive.
console.log('%c Fixture banner. https://example.invalid/', 'font-size: 14px; font-weight: bold;');
console.log('fixture-plain-warning');

@component({ name: 'NoisyThing', description: 'A component whose module logs on import.' })
export class NoisyThing extends Component {}
