// Paired with curve.vert. Simple fixed-direction lambert shading so the curved
// track reads as lit geometry rather than flat color; `uColor` lets one shader
// pair be reused for the ground, the side walls, and the neon rail trim, each
// with a different tint declared inline in the prefab's <Uniform>.
uniform vec3 uColor;
varying vec2 vUv;
varying vec3 vNormal;

void main() {
  vec3 lightDir = normalize(vec3(0.35, 1.0, 0.25));
  float diff = max(dot(normalize(vNormal), lightDir), 0.0);
  gl_FragColor = vec4(uColor * (0.75 + 0.55 * diff), 1.0);
}
