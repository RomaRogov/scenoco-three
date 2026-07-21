// The classic endless-runner "curved world" effect: bends the track downward
// with distance ahead of the camera, so it arcs away into the horizon instead
// of receding on a flat plane. `cameraPosition` is a Three.js ShaderMaterial
// built-in (world-space camera position) — no per-frame uniform sync needed
// even though dozens of track segments are spawned/destroyed as the player runs;
// every instance bends correctly using only its own transform and the camera's.
uniform float uCurve; // bend strength; the SAME value must be used on every
                      // curved surface (ground/walls) or they'll drift apart
varying vec2 vUv;
varying vec3 vNormal;

void main() {
  vUv = uv;
  vNormal = normalize(mat3(modelMatrix) * normal);

  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  // -Z is forward (see PlayerController) — "ahead" is more negative Z than the
  // camera; clamp at 0 so nothing behind the camera bends the wrong way.
  float ahead = max(0.0, cameraPosition.z - worldPos.z);
  worldPos.y -= uCurve * ahead * ahead;

  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
