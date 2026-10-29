import { BoxGeometry, CanvasTexture, CapsuleGeometry, MeshStandardMaterial, OctahedronGeometry, PlaneGeometry, RepeatWrapping, SRGBColorSpace, SphereGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// What several nodes share is made once, here, and named from the scenes: every brick of a tier
// draws one geometry and one material, so a wall of thirty bricks uploads one of each.

/** What a pickup gives the paddle. `none` is a brick that drops nothing. */
export type Bonus = 'none' | 'laser' | 'multi' | 'wide' | 'slim';
/** The bonuses in order: a table by bonus is a list in this order, as Unity serialises one. */
export const BONUSES = ['laser', 'multi', 'wide', 'slim'] as const;

/** Each bonus's colour, and the word on its pickup. */
export const bonuses = {
  laser: { color: '#ff3b6b', label: 'LASER' },
  multi: { color: '#ffd23f', label: '×3' },
  wide: { color: '#3bff9a', label: 'WIDE' },
  slim: { color: '#b18cff', label: 'SLIM' },
} as const;

/** Rounded edges everywhere: a bevel catches the light, and the bloom has an outline to follow. */
export const geometry = {
  brick: new RoundedBoxGeometry(2.3, 0.72, 0.7, 4, 0.14),
  wallSide: new RoundedBoxGeometry(0.5, 16.5, 0.9, 3, 0.2),
  wallTop: new RoundedBoxGeometry(19.5, 0.5, 0.9, 3, 0.2),
  /** The neon tube along each wall's inner edge. */
  tubeSide: new BoxGeometry(0.07, 16.2, 0.07),
  tubeTop: new BoxGeometry(18.5, 0.07, 0.07),
  paddle: new RoundedBoxGeometry(3.2, 0.48, 0.8, 5, 0.22),
  cannon: new CapsuleGeometry(0.11, 0.42, 4, 10),
  ball: new SphereGeometry(0.32, 32, 24),
  gem: new OctahedronGeometry(0.26),
  pickup: new RoundedBoxGeometry(2.1, 0.72, 0.5, 4, 0.3),
  bullet: new CapsuleGeometry(0.07, 0.5, 4, 8),
  backdrop: new PlaneGeometry(64, 44),
};

/**
 * A texture drawn once on a canvas. The neon is drawn as an emissive map: black does not glow, white
 * glows in the material's emissive colour — one map lights every tier in its own colour.
 */
function drawn(width: number, height: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, width, height);
  draw(g);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** A brick's face: a bright frame inset from the edge, a faint inner line, and a lit top edge. */
const brickGlow = drawn(512, 160, (g) => {
  // The body glows faintly in the tier's colour, brighter toward its top, so a brick reads as lit glass.
  const body = g.createLinearGradient(0, 0, 0, 160);
  body.addColorStop(0, 'rgb(120 120 120)');
  body.addColorStop(1, 'rgb(40 40 40)');
  g.fillStyle = body;
  g.beginPath();
  g.roundRect(22, 22, 468, 116, 26);
  g.fill();
  g.shadowColor = '#fff';
  g.shadowBlur = 22;
  g.strokeStyle = '#fff';
  g.lineWidth = 9;
  g.beginPath();
  g.roundRect(22, 22, 468, 116, 26);
  g.stroke();
  g.shadowBlur = 0;
  g.strokeStyle = 'rgb(255 255 255 / 0.28)';
  g.lineWidth = 4;
  g.beginPath();
  g.roundRect(44, 44, 424, 72, 16);
  g.stroke();
  g.fillStyle = 'rgb(255 255 255 / 0.5)';
  g.fillRect(70, 30, 372, 5);
});

/** The floor of the field: a fine grid that reads as depth under the tilted camera. */
const gridGlow = drawn(256, 256, (g) => {
  g.strokeStyle = 'rgb(255 255 255 / 0.55)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 256, 256);
  g.strokeStyle = 'rgb(255 255 255 / 0.16)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(128, 0);
  g.lineTo(128, 256);
  g.moveTo(0, 128);
  g.lineTo(256, 128);
  g.stroke();
});
gridGlow.wrapS = gridGlow.wrapT = RepeatWrapping;
gridGlow.repeat.set(16, 11);

/** A pickup's word, glowing, centred on its front. */
function label(text: string): CanvasTexture {
  return drawn(384, 128, (g) => {
    g.shadowColor = '#fff';
    g.shadowBlur = 16;
    g.fillStyle = '#fff';
    g.font = '900 64px Orbitron, "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 192, 68);
    g.lineWidth = 6;
    g.strokeStyle = 'rgb(255 255 255 / 0.6)';
    g.beginPath();
    g.roundRect(10, 10, 364, 108, 52);
    g.stroke();
  });
}

/** A tier: a dark lacquered body, its frame lit in the tier's colour. */
function tier(color: string, metalness: number): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, emissive: color, emissiveMap: brickGlow, emissiveIntensity: 2.2, roughness: 0.3, metalness });
}

function glow(color: string, intensity: number): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.3, metalness: 0.2 });
}

function pickup(bonus: keyof typeof bonuses): MeshStandardMaterial {
  const { color, label: text } = bonuses[bonus];
  return new MeshStandardMaterial({ color: '#0b0f1a', emissive: color, emissiveMap: label(text), emissiveIntensity: 3.2, roughness: 0.25, metalness: 0.6 });
}

export const paint = {
  backdrop: new MeshStandardMaterial({ color: '#0a1124', emissive: '#2f6bff', emissiveMap: gridGlow, emissiveIntensity: 0.5, roughness: 0.42, metalness: 0.55 }),
  wall: new MeshStandardMaterial({ color: '#1b2540', roughness: 0.35, metalness: 0.75 }),
  tube: glow('#38e1ff', 3),
  /** Hits 1, 2, 3: cyan glass, magenta, and heavy amber metal. */
  tiers: [tier('#16d9ff', 0.25), tier('#ff3dd8', 0.35), tier('#ffaa1c', 0.7)],
  /** By `BONUSES`: the gem on a brick that drops one, and the pickup's face, each in its colour. */
  gems: BONUSES.map((b) => glow(bonuses[b].color, 3.5)),
  pickups: BONUSES.map(pickup),
  paddle: new MeshStandardMaterial({ color: '#1a6f78', emissive: '#19c9ad', emissiveMap: brickGlow, emissiveIntensity: 1.2, roughness: 0.2, metalness: 0.6 }),
  cannon: glow('#ff3b6b', 2.5),
  ball: glow('#ffd88a', 2.2),
  bullet: glow('#ff5a7d', 5),
};
