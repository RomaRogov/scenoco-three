import { MeshStandardMaterial, Vector2, type MeshStandardMaterialParameters } from 'three';
import type { TerrainData } from './TerrainData.js';

export interface TerrainMaterialParameters extends Omit<MeshStandardMaterialParameters, 'normalScale'> {
  /** How far, in height-map units (0..1), a taller layer pushes through a weaker one: 0 is a plain fade. */
  heightBlend?: number;
  /** How strongly the layers' normal maps bend the light. */
  normalScale?: number;
}

/**
 * A `TerrainData`'s ground layers on three's standard material, splatted by their weights, each
 * repeating every `tileSize` metres — what `Terrain` draws with unless given a `materialTemplate`.
 * On top of a plain weighted sum it
 * - blends by height, so stones and grass blades poke through a fading neighbour instead of a smear;
 * - breaks tiling (Quilez's "texture repetition", technique 3): each sample cross-fades between two
 *   offsets chosen by a slow noise, so no grid shows from above;
 * - projects from the side as well as from above where the ground is steep (triplanar), so cliffs
 *   are not stretched;
 * - samples only the layers a pixel uses.
 * Positions and normals are the mesh's own (x, z on the ground, y up), so it works on any mesh of
 * the terrain, with or without UVs. The textures stay the data's: disposing the material leaves them.
 */
export class TerrainMaterial extends MeshStandardMaterial {
  readonly terrainData: TerrainData;
  private layerCount = 0;
  private readonly uniforms;

  constructor(terrainData: TerrainData, { heightBlend = 0.25, normalScale = 1, ...parameters }: TerrainMaterialParameters = {}) {
    super({ roughness: 0.92, metalness: 0, ...parameters });
    this.terrainData = terrainData;
    this.uniforms = {
      terrainSplats: { value: null as unknown },
      terrainColours: { value: null as unknown },
      terrainNormals: { value: null as unknown },
      terrainTiles: { value: [] as number[] },
      terrainSize: { value: new Vector2() },
      terrainBlend: { value: Math.max(heightBlend, 1e-3) },
      terrainNormalScale: { value: normalScale },
    };
    this.refresh();
    this.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.defines = { ...shader.defines, TERRAIN_LAYERS: this.layerCount };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
        .replace('#include <map_fragment>', FRAGMENT_SPLAT)
        .replace('#include <normal_fragment_maps>', 'normal = normalize(vTerrainNormalMatrix * terrainNormal);');
    };
  }

  /** Read the data's layers and size again: after its layers or size changed. `Terrain` calls it. */
  refresh(): void {
    const data = this.terrainData;
    const textures = data.textures;
    if (!textures) {
      throw new Error(`TerrainMaterial: "${data.url}" has no layer textures. Load a file with its textures — new TerrainData(url, textures) — or give a runtime one terrainLayers.`);
    }
    const tiles = data.terrainLayers.map((l) => l.tileSize);
    if (tiles.length !== this.layerCount) {
      this.layerCount = tiles.length;
      this.needsUpdate = true;
    }
    this.uniforms.terrainSplats.value = textures.splats;
    this.uniforms.terrainColours.value = textures.diffuse;
    this.uniforms.terrainNormals.value = textures.normal;
    this.uniforms.terrainTiles.value = [...tiles, ...Array<number>(8 - tiles.length).fill(1)];
    const size = data.size;
    this.uniforms.terrainSize.value.set(size.x, size.z);
  }

  override customProgramCacheKey(): string {
    return `terrain-${this.layerCount}`;
  }
}

const VERTEX_HEAD = /* glsl */ `
varying vec3 vTerrainPosition;
varying vec3 vTerrainNormal;
varying mat3 vTerrainNormalMatrix;
`;

const VERTEX_BODY = /* glsl */ `
vTerrainPosition = position;
vTerrainNormal = objectNormal;
vTerrainNormalMatrix = normalMatrix;
`;

const FRAGMENT_HEAD = /* glsl */ `
uniform sampler2DArray terrainSplats;
uniform sampler2DArray terrainColours;
uniform sampler2DArray terrainNormals;
uniform float terrainTiles[8];
uniform vec2 terrainSize;
uniform float terrainBlend;
uniform float terrainNormalScale;
varying vec3 vTerrainPosition;
varying vec3 vTerrainNormal;
varying mat3 vTerrainNormalMatrix;

float terrainHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float terrainNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(terrainHash(i), terrainHash(i + vec2(1.0, 0.0)), f.x),
             mix(terrainHash(i + vec2(0.0, 1.0)), terrainHash(i + vec2(1.0)), f.x), f.y);
}

// One planar projection of one layer, its repetition broken: two offsets picked by a noise a few
// tiles across, cross-faded where the noise steps. Gradients come in from outside, so branches
// around this call do not break mipmapping. colour.rgb, then normal x, y (-1..1) and height.
void terrainSample(float layer, vec2 uv, vec2 dx, vec2 dy, out vec3 colour, out vec3 normalHeight) {
  float l = terrainNoise(uv * 0.4) * 8.0;
  float i = floor(l);
  vec2 offsetA = sin(vec2(3.0, 7.0) * i);
  vec2 offsetB = sin(vec2(3.0, 7.0) * (i + 1.0));
  vec3 colourA = textureGrad(terrainColours, vec3(uv + offsetA, layer), dx, dy).rgb;
  vec3 colourB = textureGrad(terrainColours, vec3(uv + offsetB, layer), dx, dy).rgb;
  vec3 normalA = textureGrad(terrainNormals, vec3(uv + offsetA, layer), dx, dy).xyz;
  vec3 normalB = textureGrad(terrainNormals, vec3(uv + offsetB, layer), dx, dy).xyz;
  float t = smoothstep(0.2, 0.8, fract(l) - 0.1 * dot(colourA - colourB, vec3(1.0)));
  colour = mix(colourA, colourB, t);
  normalHeight = mix(normalA, normalB, t);
  normalHeight.xy = normalHeight.xy * 2.0 - 1.0;
}
`;

const FRAGMENT_SPLAT = /* glsl */ `
vec3 terrainUp = normalize(vTerrainNormal);
// Where each projection counts: from above on flat ground, from the sides on cliffs.
vec3 terrainFaces = pow(abs(terrainUp), vec3(6.0));
terrainFaces /= terrainFaces.x + terrainFaces.y + terrainFaces.z;
vec3 terrainDx = dFdx(vTerrainPosition);
vec3 terrainDy = dFdy(vTerrainPosition);
vec2 terrainSplatUv = (vTerrainPosition.xz + terrainSize * 0.5) / terrainSize;
vec4 terrainWeightsA = texture(terrainSplats, vec3(terrainSplatUv, 0.0));
vec4 terrainWeightsB = TERRAIN_LAYERS > 4 ? texture(terrainSplats, vec3(terrainSplatUv, 1.0)) : vec4(0.0);

vec3 terrainColour[TERRAIN_LAYERS];
vec3 terrainBend[TERRAIN_LAYERS];
float terrainLevel[TERRAIN_LAYERS];
float terrainTop = -1.0;
for (int i = 0; i < TERRAIN_LAYERS; i++) {
  float weight = i < 4 ? terrainWeightsA[i] : terrainWeightsB[i - 4];
  terrainLevel[i] = -1.0;
  if (weight < 0.004) continue;
  float tile = terrainTiles[i];
  vec3 colour = vec3(0.0);
  vec3 bend = vec3(0.0);
  float height = 0.0;
  vec3 c;
  vec3 nh;
  // Each projection's normal (u, v) bent into the axes it lies in; v runs against the image's up.
  if (terrainFaces.y > 0.01) {
    terrainSample(float(i), vTerrainPosition.xz / tile, terrainDx.xz / tile, terrainDy.xz / tile, c, nh);
    colour += c * terrainFaces.y; height += nh.z * terrainFaces.y; bend += vec3(nh.x, 0.0, -nh.y) * terrainFaces.y;
  }
  if (terrainFaces.x > 0.01) {
    terrainSample(float(i), vTerrainPosition.zy / tile, terrainDx.zy / tile, terrainDy.zy / tile, c, nh);
    colour += c * terrainFaces.x; height += nh.z * terrainFaces.x; bend += vec3(0.0, -nh.y, nh.x) * terrainFaces.x;
  }
  if (terrainFaces.z > 0.01) {
    terrainSample(float(i), vTerrainPosition.xy / tile, terrainDx.xy / tile, terrainDy.xy / tile, c, nh);
    colour += c * terrainFaces.z; height += nh.z * terrainFaces.z; bend += vec3(nh.x, -nh.y, 0.0) * terrainFaces.z;
  }
  terrainColour[i] = colour;
  terrainBend[i] = bend;
  // Height blending: a layer's weight raised by its own height; only those near the top show.
  terrainLevel[i] = weight + height * terrainBlend;
  terrainTop = max(terrainTop, terrainLevel[i]);
}
vec3 terrainAlbedo = vec3(0.0);
vec3 terrainBendSum = vec3(0.0);
float terrainTotal = 0.0;
for (int i = 0; i < TERRAIN_LAYERS; i++) {
  float share = max(terrainLevel[i] - (terrainTop - terrainBlend), 0.0);
  if (share <= 0.0) continue;
  terrainAlbedo += terrainColour[i] * share;
  terrainBendSum += terrainBend[i] * share;
  terrainTotal += share;
}
terrainAlbedo /= max(terrainTotal, 1e-5);
// A slow brightness swell over tens of metres, so one layer is not one flat colour across the map.
terrainAlbedo *= mix(0.88, 1.08, terrainNoise(vTerrainPosition.xz / 23.0));
diffuseColor.rgb *= terrainAlbedo;
vec3 terrainNormal = normalize(terrainUp + terrainBendSum / max(terrainTotal, 1e-5) * terrainNormalScale);
`;
