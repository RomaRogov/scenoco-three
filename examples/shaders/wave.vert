// ShaderMaterial provides `position`, `uv`, `projectionMatrix`, `modelViewMatrix`.
uniform float uTime;
varying vec2 vUv;

void main() {
  vUv = uv;
  vec3 p = position;
  p.z += sin(p.x * 4.0 + uTime) * 0.2; // ripple along x over time
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
