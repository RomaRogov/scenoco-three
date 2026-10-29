import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

/**
 * The neon, drawn on canvases: each is a texture class a scene names as a tag, filling a material's
 * `emissiveMap` — `<NeonFrameTexture attach="emissiveMap" />`. The map is drawn in white on black:
 * black does not glow, white glows in the material's own `emissive` colour, so one drawing lights
 * every tier in its colour. A drawing is made once and its canvas shared by every texture of it.
 */
const drawings = new Map<string, HTMLCanvasElement>();
function drawing(key: string, width: number, height: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  let canvas = drawings.get(key);
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, width, height);
  draw(g);
  drawings.set(key, canvas);
  return canvas;
}

class NeonTexture extends CanvasTexture {
  constructor(canvas: HTMLCanvasElement) {
    super(canvas);
    this.colorSpace = SRGBColorSpace;
    this.anisotropy = 8;
  }
}

/** A brick's or the paddle's face: a bright frame inset from the edge, a faint inner line, a lit top edge. */
export class NeonFrameTexture extends NeonTexture {
  constructor() {
    super(
      drawing('frame', 512, 160, (g) => {
        // The body glows faintly, brighter toward its top, so a brick reads as lit glass.
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
      }),
    );
  }
}

/** The floor of the field: one cell of a fine grid, repeated — `repeat={[16, 11]}` sets how many. */
export class NeonGridTexture extends NeonTexture {
  constructor() {
    super(
      drawing('grid', 256, 256, (g) => {
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
      }),
    );
    this.wrapS = this.wrapT = RepeatWrapping;
  }
}

/** A word in a rounded frame, glowing: a pickup's face. `args={['LASER']}`. */
export class NeonLabelTexture extends NeonTexture {
  constructor(text = '') {
    super(
      drawing(`label:${text}`, 384, 128, (g) => {
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
      }),
    );
  }
}
