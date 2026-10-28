import { MeshStandardMaterial, Vector2, type MeshStandardMaterialParameters } from 'three';
import type { TerrainData } from './TerrainData.js';

export interface TerrainMaterialParameters extends Omit<MeshStandardMaterialParameters, 'normalScale'> {
  /** How far, in height-map units (0..1), a taller layer pushes through a weaker one: 0 is a plain fade. */
  heightBlend?: number;
  /** How strongly the layers' normal maps bend the light. */
  normalScale?: number;
  /** Whether steep ground is also projected from the side, so cliffs are not stretched. */
  sideProjection?: boolean;
}

/**
 * A `TerrainData`'s ground layers on three's standard material, splatted by their weights, each
 * repeating every `tileSize` metres — what `Terrain` draws with unless given a `materialTemplate`.
 * Every pixel does a small, fixed amount of work, branch-free but for skipping the side on flat
 * ground, so it suits phones:
 * - the two layers that weigh most there, blended by height, so stones and grass blades poke
 *   through a fading neighbour instead of a smear;
 * - tiling broken up (Quilez's "texture repetition", technique 3): each sample cross-fades between
 *   two offsets chosen by a slow noise, so no grid shows from above;
 * - with `sideProjection`, ground steeper than 45° projected from the side instead of from above,
 *   so cliffs are not stretched — one projection per pixel, so it reads no more than flat ground.
 * Positions and normals are the mesh's own (x, z on the ground, y up), so it works on any mesh of
 * the terrain, with or without UVs. The textures stay the data's: disposing the material leaves them.
 */
export class TerrainMaterial extends MeshStandardMaterial {
  readonly terrainData: TerrainData;
  private layerCount = 0;
  private sides: boolean;
  private readonly uniforms;

  constructor(terrainData: TerrainData, { heightBlend = 0.25, normalScale = 1, sideProjection = true, ...parameters }: TerrainMaterialParameters = {}) {
    super({ roughness: 0.92, metalness: 0, ...parameters });
    this.terrainData = terrainData;
    this.sides = sideProjection;
    this.uniforms = {
      terrainSplats: { value: null as unknown },
      terrainColours: { value: null as unknown },
      terrainNormals: { value: null as unknown },
      terrainTiles: { value: [] as number[] },
      terrainTileScale: { value: 1 },
      terrainSize: { value: new Vector2() },
      terrainBlend: { value: Math.max(heightBlend, 1e-3) },
      terrainNormalScale: { value: normalScale },
    };
    this.refresh();
    this.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.defines = { ...shader.defines, TERRAIN_LAYERS: this.layerCount, TERRAIN_SIDES: this.sides ? 1 : 0 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
        .replace('#include <map_fragment>', FRAGMENT_SPLAT)
        .replace('#include <normal_fragment_maps>', 'normal = normalize(normalMatrix * terrainNormal);');
    };
  }

  /** Every layer's tile size times this: above 1 each texture repeats less often. */
  get tileScale(): number {
    return this.uniforms.terrainTileScale.value;
  }

  set tileScale(scale: number) {
    this.uniforms.terrainTileScale.value = scale > 0 ? scale : 1;
  }

  /** Whether steep ground is also projected from the side. Changing it builds the shader again. */
  get sideProjection(): boolean {
    return this.sides;
  }

  set sideProjection(on: boolean) {
    if (on === this.sides) return;
    this.sides = on;
    this.needsUpdate = true;
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
    return `terrain-${this.layerCount}-${this.sides ? 'sides' : 'top'}`;
  }
}

const VERTEX_HEAD = /* glsl */ `
uniform vec2 terrainSize;
varying vec3 vTerrainPosition;
varying vec2 vTerrainSplatUv;
varying vec3 vTerrainNormal;
`;

const VERTEX_BODY = /* glsl */ `
vTerrainPosition = position;
vTerrainSplatUv = (position.xz + terrainSize * 0.5) / terrainSize;
vTerrainNormal = objectNormal;
`;

const FRAGMENT_HEAD = /* glsl */ `
uniform sampler2DArray terrainSplats;
uniform sampler2DArray terrainColours;
uniform sampler2DArray terrainNormals;
uniform float terrainTiles[8];
uniform float terrainTileScale;
uniform float terrainBlend;
uniform float terrainNormalScale;
uniform mat3 normalMatrix;
varying vec3 vTerrainPosition;
varying vec2 vTerrainSplatUv;
varying vec3 vTerrainNormal;

// Without sin: sin of a large number is noise of its own at a phone's precision.
float terrainHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float terrainNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(terrainHash(i), terrainHash(i + vec2(1.0, 0.0)), f.x),
             mix(terrainHash(i + vec2(0.0, 1.0)), terrainHash(i + vec2(1.0)), f.x), f.y);
}

// One planar projection of one layer, its repetition broken: two offsets cross-faded by \`fade\`,
// nudged by the samples themselves so the seam follows the picture. Gradients come in from outside.
// colour.rgb, then normal x, y (-1..1) and height.
void terrainSample(float layer, vec2 uv, vec2 dx, vec2 dy, vec2 offsetA, vec2 offsetB, mediump float fade, out mediump vec3 colour, out mediump vec3 normalHeight) {
  mediump vec3 colourA = textureGrad(terrainColours, vec3(uv + offsetA, layer), dx, dy).rgb;
  mediump vec3 colourB = textureGrad(terrainColours, vec3(uv + offsetB, layer), dx, dy).rgb;
  mediump vec3 normalA = textureGrad(terrainNormals, vec3(uv + offsetA, layer), dx, dy).xyz;
  mediump vec3 normalB = textureGrad(terrainNormals, vec3(uv + offsetB, layer), dx, dy).xyz;
  mediump float t = smoothstep(0.2, 0.8, fade - 0.1 * dot(colourA - colourB, vec3(1.0)));
  colour = mix(colourA, colourB, t);
  normalHeight = mix(normalA, normalB, t);
  normalHeight.xy = normalHeight.xy * 2.0 - 1.0;
}

// One layer at the pixel's texture coordinates. \`across\` is the texture's x on the ground: on flat
// ground, x itself; on a cliff, the way along it. \`bend\` is the normal map's tilt in the terrain's axes.
void terrainLayer(float layer, vec2 uv, vec2 dx, vec2 dy, mediump vec2 across, mediump float cliff, vec2 offsetA, vec2 offsetB, mediump float fade, out mediump vec3 colour, out mediump vec3 bend, out mediump float height) {
  float tile = terrainTiles[int(layer)] * terrainTileScale;
  mediump vec3 nh;
  terrainSample(layer, uv / tile, dx / tile, dy / tile, offsetA, offsetB, fade, colour, nh);
  height = nh.z;
  bend = mix(vec3(nh.x, 0.0, -nh.y), vec3(across.x * nh.x, -nh.y, across.y * nh.x), cliff);
}
`;

const FRAGMENT_SPLAT = /* glsl */ `
mediump vec4 terrainWeightsA = texture(terrainSplats, vec3(vTerrainSplatUv, 0.0));
#if TERRAIN_LAYERS > 4
  mediump vec4 terrainWeightsB = texture(terrainSplats, vec3(vTerrainSplatUv, 1.0));
#else
  mediump vec4 terrainWeightsB = vec4(0.0);
#endif

// The two layers that weigh most here, picked without branches: the loop unrolls, each step a mix.
mediump float terrainFirst = -1.0;
mediump float terrainSecond = -1.0;
float terrainFirstLayer = 0.0;
float terrainSecondLayer = 0.0;
for (int i = 0; i < TERRAIN_LAYERS; i++) {
  mediump float weight = i < 4 ? terrainWeightsA[i] : terrainWeightsB[i - 4];
  float layer = float(i);
  mediump float beatsFirst = step(terrainFirst, weight);
  mediump float beatsSecond = step(terrainSecond, weight) * (1.0 - beatsFirst);
  terrainSecond = mix(mix(terrainSecond, weight, beatsSecond), terrainFirst, beatsFirst);
  terrainSecondLayer = mix(mix(terrainSecondLayer, layer, beatsSecond), terrainFirstLayer, beatsFirst);
  terrainFirst = mix(terrainFirst, weight, beatsFirst);
  terrainFirstLayer = mix(terrainFirstLayer, layer, beatsFirst);
}

// One noise for every layer and projection: which two offsets this pixel cross-fades between.
float terrainPick = terrainNoise(vTerrainPosition.xz / 30.0) * 8.0;
float terrainStep = floor(terrainPick);
vec2 terrainOffsetA = sin(vec2(3.0, 7.0) * terrainStep);
vec2 terrainOffsetB = sin(vec2(3.0, 7.0) * (terrainStep + 1.0));
vec3 terrainDx = dFdx(vTerrainPosition);
vec3 terrainDy = dFdy(vTerrainPosition);

// Where the texture goes: from above, or — with TERRAIN_SIDES, on ground steeper than 45° — from the
// side, along the cliff and up it, so a cliff is not one stretched streak. One projection per
// pixel, never a blend of several: the same reads as flat ground (Terrain3D's way). The way along is
// snapped to the 8 compass directions, so a cliff's texture holds still across its uneven face.
vec2 terrainUv = vTerrainPosition.xz;
vec2 terrainUvDx = terrainDx.xz;
vec2 terrainUvDy = terrainDy.xz;
mediump vec2 terrainAcross = vec2(1.0, 0.0);
mediump float terrainCliff = 0.0;
#if TERRAIN_SIDES
  vec3 terrainFacing = normalize(vTerrainNormal);
  if (terrainFacing.y < 0.7071068) {
    // Snapped without atan (Quilez, "noatan"): rounding a scaled direction lands on the 8 compass points.
    vec2 compass = round(normalize(terrainFacing.xz) * 1.3065630);
    compass *= abs(compass.x) + abs(compass.y) > 1.5 ? 0.7071068 : 1.0;
    terrainAcross = vec2(-compass.y, compass.x);
    terrainUv = vec2(dot(vTerrainPosition.xz, terrainAcross), vTerrainPosition.y);
    terrainUvDx = vec2(dot(terrainDx.xz, terrainAcross), terrainDx.y);
    terrainUvDy = vec2(dot(terrainDy.xz, terrainAcross), terrainDy.y);
    terrainCliff = 1.0;
  }
#endif

mediump vec3 terrainColourA;
mediump vec3 terrainBendA;
mediump float terrainHeightA;
mediump vec3 terrainColourB;
mediump vec3 terrainBendB;
mediump float terrainHeightB;
terrainLayer(terrainFirstLayer, terrainUv, terrainUvDx, terrainUvDy, terrainAcross, terrainCliff, terrainOffsetA, terrainOffsetB, fract(terrainPick), terrainColourA, terrainBendA, terrainHeightA);
terrainLayer(terrainSecondLayer, terrainUv, terrainUvDx, terrainUvDy, terrainAcross, terrainCliff, terrainOffsetA, terrainOffsetB, fract(terrainPick), terrainColourB, terrainBendB, terrainHeightB);

// Height blending: each layer's weight raised by its own height; only what is near the top shows.
mediump float terrainLevelA = terrainFirst + terrainHeightA * terrainBlend;
mediump float terrainLevelB = terrainSecond + terrainHeightB * terrainBlend;
mediump float terrainFloor = max(terrainLevelA, terrainLevelB) - terrainBlend;
mediump float terrainShareA = max(terrainLevelA - terrainFloor, 0.0);
mediump float terrainShareB = max(terrainLevelB - terrainFloor, 0.0);
mediump float terrainTotal = max(terrainShareA + terrainShareB, 1e-4);
mediump vec3 terrainAlbedo = (terrainColourA * terrainShareA + terrainColourB * terrainShareB) / terrainTotal;
mediump vec3 terrainBend = (terrainBendA * terrainShareA + terrainBendB * terrainShareB) / terrainTotal;
// A slow brightness swell over tens of metres, so one layer is not one flat colour across the map.
terrainAlbedo *= mix(0.88, 1.08, terrainNoise(vTerrainPosition.xz / 23.0));
diffuseColor.rgb *= terrainAlbedo;
vec3 terrainNormal = normalize(normalize(vTerrainNormal) + terrainBend * terrainNormalScale);
`;
