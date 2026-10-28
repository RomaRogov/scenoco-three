import { DoubleSide, Mesh, PlaneGeometry, ShaderMaterial, Vector3, type Camera } from 'three';

/**
 * The editor's ground grid, as Unity's scene view draws one: the plane through the origin with no
 * edge — it fades with distance instead — and cells a power of ten wide, finer as the camera comes
 * down and coarser as it rises, one size blending into the next. The X axis is red, Z blue.
 *
 * One quad under the camera; the lines are worked out per pixel, so they stay one pixel wide and
 * smooth at any distance and angle.
 */
export class EditorGrid extends Mesh<PlaneGeometry, ShaderMaterial> {
  constructor() {
    super(
      new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new ShaderMaterial({
        uniforms: { eye: { value: new Vector3() }, reach: { value: 100 } },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        // Seen from below too — but in one pass: three draws a transparent two-sided material
        // twice, back faces then front, and a flat plane would blend every line over itself.
        side: DoubleSide,
        forceSinglePass: true,
      }),
    );
    this.frustumCulled = false;
    this.renderOrder = -1;
  }

  /** Under the camera, wide enough to fade out before it ends: once a frame. */
  follow(camera: Camera): void {
    const eye = camera.getWorldPosition(this.material.uniforms.eye!.value as Vector3);
    // How far the grid shows grows with height, as a view from higher up sees further.
    const reach = Math.max(40, Math.abs(eye.y) * 25);
    this.material.uniforms.reach!.value = reach;
    this.position.set(eye.x, 0, eye.z);
    this.scale.set(reach * 2, 1, reach * 2);
  }
}

const VERTEX = /* glsl */ `
varying vec3 world;
void main() {
  vec4 at = modelMatrix * vec4(position, 1.0);
  world = at.xyz;
  gl_Position = projectionMatrix * viewMatrix * at;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 eye;
uniform float reach;
varying vec3 world;

// 1 on a line of a grid of cells this wide, 0 between, about a pixel across at any distance. Cells
// only a few pixels wide would be a haze of lines — toward the horizon, or from high up — so a size
// fades out as its cells shrink on screen, and the next size up carries the grid.
float lines(vec2 at, float cell) {
  vec2 c = at / cell;
  vec2 width = fwidth(c);
  vec2 off = abs(fract(c - 0.5) - 0.5) / max(width, vec2(1e-5));
  float line = 1.0 - min(min(off.x, off.y), 1.0);
  return line * (1.0 - smoothstep(0.15, 0.33, max(width.x, width.y)));
}

// 1 on the axis line through the origin along the other coordinate, two pixels wide.
float axis(float coordinate) {
  return 1.0 - smoothstep(0.5, 1.5, abs(coordinate) / max(fwidth(coordinate), 1e-5));
}

void main() {
  vec2 at = world.xz;
  // Cell sizes from the camera's height: 1 m close to the ground, 10 m higher, 100 m higher still.
  float height = max(abs(eye.y), 1.0);
  float level = log(height) / log(10.0);
  float small = pow(10.0, floor(level) - 1.0);
  float blend = fract(level);
  float fine = lines(at, small) * (1.0 - blend);
  float mid = lines(at, small * 10.0);
  float coarse = lines(at, small * 100.0);
  float alpha = max(fine * 0.14, max(mid * 0.24, coarse * 0.36));
  vec3 color = vec3(0.5, 0.56, 0.63);

  float onX = axis(world.z);
  float onZ = axis(world.x);
  if (onX > 0.0) { color = mix(color, vec3(0.9, 0.3, 0.3), onX); alpha = max(alpha, onX * 0.9); }
  if (onZ > 0.0) { color = mix(color, vec3(0.3, 0.5, 0.95), onZ); alpha = max(alpha, onZ * 0.9); }

  // No edge: gone before the quad ends, and thinner where the plane is seen edge on.
  float distance = length(world.xz - eye.xz);
  float fade = 1.0 - smoothstep(reach * 0.35, reach, distance);
  gl_FragColor = vec4(color, alpha * fade);
  if (gl_FragColor.a < 0.002) discard;
}
`;
