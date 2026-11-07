# API

Every public signature of `@scenoco-three/postprocessing`. Read this instead of `src/`. It draws
through three.js's `EffectComposer`; everything not here is three.js, as three.js documents it.

```ts
// A Volume and its effects, as components on one node — URP's Volume and Volume Profile:
//   <Group name="Look">
//     <Volume />
//     <Bloom intensity={1} threshold={0.9} />
//     <Tonemapping mode="ACES" />
//   </Group>
// Every field is read every frame, so it can be tweened; enabled = false drops one effect.
class Volume extends Behaviour {
  priority: number;            // 0. Per effect, the highest-priority active Volume that has it wins; the newest of equals
}
// While a Volume is active it replaces game.render. Under simulate there is no renderer: it does nothing.
// At a QualitySettings level with postProcessing false, the scene draws without effects; Tonemapping still applies.

class Tonemapping extends Behaviour {   // sets renderer.toneMapping while it draws: set the curve here or on
  mode: 'None' | 'Neutral' | 'ACES';    // the renderer, not both. 'ACES'
}
class Bloom extends Behaviour {         // light above threshold spilling into what is around it
  threshold: number;           // 0.9, in linear light, with URP's soft knee: an emissive colour above 1 glows
  intensity: number;           // 1, as URP's: the glow added once
  scatter: number;             // 0.7: how far it spreads, 0..1
  tint: Color;                 // white
}
class ColorAdjustments extends Behaviour {   // the whole picture's colour
  postExposure: number;        // 0, in stops: +1 is twice the light
  contrast: number;            // 0, -100..100
  colorFilter: Color;          // white: multiplies every pixel
  hueShift: number;            // 0, degrees, -180..180
  saturation: number;          // 0, -100..100: -100 is grey
}
class Vignette extends Behaviour {      // the corners darkened
  color: Color;                // black
  center: Vector2;             // (0.5, 0.5), 0..1 across the screen
  intensity: number;           // 0.3, 0..1
  smoothness: number;          // 0.2: how soft its edge is, 0..1
}
class DepthOfField extends Behaviour {  // a lens's blur away from its focus; a PerspectiveCamera only
  focusDistance: number;       // 10: metres from the camera that are sharp
  focalLength: number;         // 50, millimetres
  aperture: number;            // 5.6, the f-stop: lower blurs more
}
class ChromaticAberration extends Behaviour {   // colour fringes towards the edges
  intensity: number;           // 0.3, 0..1
}
class FilmGrain extends Behaviour {     // noise over the picture
  intensity: number;           // 0.3, 0..1
}
```
