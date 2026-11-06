# API

Every public signature of `@scenoco-three/particles`. Read this instead of `src/`. It draws with
three.quarks; everything not here is three.js, as three.js documents it.

```ts
// An effect is data, a constant in a .ts module — Unity's Shuriken modules as one typed object,
// every field optional, angles in degrees:
//   export const fire: ParticleEffect = { startLifetime: 1.6, startSpeed: 4.5, emission: { rateOverTime: 90 } };
// played by a component on the node it comes from: <ParticleSystem effect={vfx.fire} />
class ParticleSystem extends Behaviour {   // Unity's ParticleSystem; every emitter in a scene draws through one batch
  effect: ParticleEffect;
  playOnAwake: boolean;        // true
  readonly isPlaying: boolean;
  readonly particleCount: number;   // alive now
  readonly system: QuarksSystem | null;   // three.quarks' live system, for anything not here
  play(): void;                // start, or resume after pause()
  pause(): void;               // stop emitting and stepping; the live particles stay. Disabling the component pauses
  stop(): void;                // stop emitting and clear the live particles
  restart(): void;             // clear, and play from the top
}

interface ParticleEffect {     // the main module, then the others
  duration?: number;           // seconds of one emission cycle
  looping?: boolean;
  prewarm?: boolean;           // the first cycle starts as if one had already run
  startLifetime?: number;      // seconds
  startSpeed?: number;
  startSize?: number;
  startRotation?: number;      // degrees
  startColor?: Color;
  gravityModifier?: number;    // times Unity's gravity
  simulationSpace?: 'Local' | 'World';   // Local: particles follow the emitter
  emission?: { rateOverTime?: number; bursts?: { time: number; count: number }[] };
  shape?: {
    type?: 'Cone' | 'Sphere' | 'Hemisphere' | 'Circle' | 'Donut' | 'Rectangle' | 'Point';
    radius?: number;
    angle?: number;            // a cone's half-angle
    arc?: number;              // how much of the shape emits; 360 is all
  };
  renderer?: {
    renderMode?: 'Billboard' | 'StretchedBillboard' | 'HorizontalBillboard' | 'VerticalBillboard' | 'Mesh';
    blending?: 'Additive' | 'Alpha';
    texture?: Texture;         // the sprite; a soft dot when left out
  };
  noise?: { strength?: number; frequency?: number };
  colorOverLifetime?: { colors: Color[] };          // evenly spaced keys
  sizeOverLifetime?: { curve: number[] };           // multipliers, evenly spaced keys
  rotationOverLifetime?: { angularVelocity: number };   // degrees a second
}
// The modules' own types, for a value built apart: Emission, Burst, Shape, Renderer, Noise,
// ColorOverLifetime, SizeOverLifetime, RotationOverLifetime, SimulationSpace, ParticleShape,
// ParticleRenderMode, ParticleBlending.
function configToParameters(effect: ParticleEffect): ParticleSystemParameters;   // three.quarks' parameters, to build one yourself
```
