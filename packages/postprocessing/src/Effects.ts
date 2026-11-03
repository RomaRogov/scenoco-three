import { Color, Vector2 } from 'three';
import { Behaviour } from '@scenoco-three/core';

/** Light above `threshold` spilling into what is around it. */
export class Bloom extends Behaviour {
  /** How bright a pixel must be, in linear light, to glow. 1 glows only what is brighter than white. */
  threshold = 0.9;
  intensity = 1;
  /** How far it spreads, 0 to 1. */
  scatter = 0.7;
  tint = new Color('#ffffff');
}

/** The curve that fits bright light onto the screen. */
export class Tonemapping extends Behaviour {
  mode: 'None' | 'Neutral' | 'ACES' = 'ACES';
}

/** The whole picture's colour. */
export class ColorAdjustments extends Behaviour {
  /** In stops: +1 is twice the light. */
  postExposure = 0;
  /** -100 to 100. */
  contrast = 0;
  colorFilter = new Color('#ffffff');
  /** Degrees, -180 to 180. */
  hueShift = 0;
  /** -100 to 100: -100 is grey. */
  saturation = 0;
}

/** The corners darkened. */
export class Vignette extends Behaviour {
  color = new Color('#000000');
  /** Where it is centred, 0 to 1 across the screen. */
  center = new Vector2(0.5, 0.5);
  /** 0 to 1. */
  intensity = 0.3;
  /** How soft its edge is, 0 to 1. */
  smoothness = 0.2;
}

/** A lens's blur away from where it is focused. Perspective cameras only. */
export class DepthOfField extends Behaviour {
  /** Metres from the camera that are sharp. */
  focusDistance = 10;
  /** Millimetres. */
  focalLength = 50;
  /** The f-stop: lower blurs more. */
  aperture = 5.6;
}

/** Colour fringes towards the screen's edges. */
export class ChromaticAberration extends Behaviour {
  /** 0 to 1. */
  intensity = 0.3;
}

/** Noise over the picture. */
export class FilmGrain extends Behaviour {
  /** 0 to 1. */
  intensity = 0.3;
}
