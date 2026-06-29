uniform vec3 uColor;  // declared in XML
uniform float uTime;  // declared in the shader only — set per-frame at runtime
varying vec2 vUv;

void main() {
  float w = 0.5 + 0.5 * sin(vUv.x * 10.0 + uTime);
  gl_FragColor = vec4(uColor * w, 1.0);
}
