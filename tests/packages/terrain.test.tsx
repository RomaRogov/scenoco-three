import { afterEach, describe, expect, it } from 'vitest';
import { Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import { Runtime, loadAssets, wake } from '@scenoco-three/core';
import { Terrain, TerrainData, type TerrainMaterial } from '@scenoco-three/terrain';
import { provideCamera } from '../../packages/core/src/kernel/camera';

const runtimes: Runtime[] = [];
afterEach(() => runtimes.splice(0).forEach((r) => r.dispose()));

/** A `.terrain` file, written the way the asset lab writes one: as a data: URL. */
async function terrainFile(heights: number[][], size: number, weights: number[][][], step = 0.01): Promise<string> {
  const n = heights.length;
  const minY = Math.min(...heights.flat());
  const q = heights.map((row) => row.map((h) => Math.round((h - minY) / step)));
  const payload = new Uint8Array(n * n * 2 + weights.length * weights[0]!.length ** 2);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const predicted = r && c ? q[r]![c - 1]! + q[r - 1]![c]! - q[r - 1]![c - 1]! : c ? q[r]![c - 1]! : r ? q[r - 1]![c]! : 0;
      const residual = q[r]![c]! - predicted;
      const zigzag = residual >= 0 ? residual * 2 : -residual * 2 - 1;
      payload[r * n + c] = zigzag & 0xff;
      payload[n * n + r * n + c] = zigzag >> 8;
    }
  }
  payload.set(weights.flat(2), n * n * 2);
  const header = new TextEncoder().encode(JSON.stringify({
    size, minY, maxY: Math.max(...heights.flat()), heightStep: step, heightmapResolution: n,
    alphamapResolution: weights[0]!.length, layers: weights.map((_, i) => ({ name: `layer${i}`, tileSize: 4 })),
  }));
  const gzip = new Uint8Array(await new Response(new Blob([payload]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  const file = new Uint8Array(12 + header.length + gzip.length);
  file.set(new TextEncoder().encode('SNCTRRN1'));
  new DataView(file.buffer).setUint32(8, header.length, true);
  file.set(header, 12);
  file.set(gzip, 12 + header.length);
  return `data:application/octet-stream;base64,${Buffer.from(file).toString('base64')}`;
}

// A 3x3 ramp over 20 m: 0 m at -x, 10 m at +x, with a 2.5 m bump in the middle.
const ramp = [
  [0, 5, 10],
  [0, 7.5, 10],
  [0, 5, 10],
];

describe('terrain', () => {
  it('reads heights and layers from a .terrain file', async () => {
    const data = new TerrainData(await terrainFile(ramp, 20, [[[255, 0], [0, 255]], [[0, 255], [255, 0]]]));
    await loadAssets(data);
    expect(data.size.toArray()).toEqual([20, 10, 20]);
    expect(data.heightmapResolution).toBe(3);
    expect(data.alphamapLayers).toBe(2);
    expect(data.terrainLayers.map((l) => l.name)).toEqual(['layer0', 'layer1']);
    expect(data.getHeight(1, 1)).toBeCloseTo(7.5, 5);
    expect(data.getInterpolatedHeight(0.25, 0)).toBeCloseTo(2.5, 5);
    expect(data.getInterpolatedHeight(0.5, 0.25)).toBeCloseTo(6.25, 5);
  });

  it('builds its ground from the heights and samples them in world space', async () => {
    const data = new TerrainData(await terrainFile(ramp, 20, [[[255]]]));
    await loadAssets(data);
    const scene = new Scene();
    const node = new Group();
    node.scale.setScalar(0.5);
    node.position.set(100, 3, 0);
    node.addComponent(Terrain, { terrainData: data, materialTemplate: new MeshStandardMaterial() });
    scene.add(node);
    start(scene);

    const chunk = node.children[0] as Mesh;
    chunk.geometry.computeBoundingBox();
    expect(chunk.geometry.boundingBox!.min.toArray()).toEqual([-10, 0, -10]);
    expect(chunk.geometry.boundingBox!.max.toArray()).toEqual([10, 10, 10]);
    // Every triangle faces up.
    const position = chunk.geometry.getAttribute('position');
    const index = chunk.geometry.index!;
    const [a, b, c] = [0, 1, 2].map((k) => new Vector3().fromBufferAttribute(position, index.getX(k)));
    expect(b!.sub(a!).cross(c!.sub(a!)).y).toBeGreaterThan(0);
    const terrain = node.getComponent(Terrain)!;
    // The middle sample, 7.5 m, at half scale: 3.75 above the terrain's own height.
    expect(terrain.sampleHeight(new Vector3(100, 50, 0))).toBeCloseTo(3.75, 5);
    // Halfway to +x on the middle row: between 7.5 and 10 m.
    expect(terrain.sampleHeight(new Vector3(102.5, 0, 0))).toBeCloseTo(4.375, 5);
  });

  it('scales every layer\'s tiling by tileScale, and turns side projection off, while it runs', async () => {
    const data = new TerrainData(await terrainFile(ramp, 20, [[[255]]]));
    await loadAssets(data);
    // The layers' textures as drawn need a canvas: stand-ins, since only the tiling is looked at.
    Object.defineProperty(data, 'textures', { get: () => ({ splats: {}, diffuse: {}, normal: {} }) });
    const scene = new Scene();
    const node = new Group();
    const terrain = node.addComponent(Terrain, { terrainData: data, tileScale: 2 });
    scene.add(node);
    start(scene);
    const material = (node.children[0] as Mesh).material as TerrainMaterial;
    expect(material.tileScale).toBe(2);
    terrain.tileScale = 3;
    terrain.onValidate();
    expect(material.tileScale).toBe(3);
    // Off is another shader: compiled again, under its own key.
    const sides = material.customProgramCacheKey();
    terrain.sideProjection = false;
    terrain.onValidate();
    expect(material.sideProjection).toBe(false);
    expect(material.customProgramCacheKey()).not.toBe(sides);
  });

  it('draws fewer triangles where the camera is far and the ground is flat', async () => {
    // 257 samples over 256 m: flat, with one hill in the middle — four chunks a side.
    const hills = Array.from({ length: 257 }, (_, r) => Array.from({ length: 257 }, (_, c) => 20 * Math.exp(-((r - 128) ** 2 + (c - 128) ** 2) / 800)));
    const data = new TerrainData(await terrainFile(hills, 256, [[[255]]]));
    await loadAssets(data);
    const scene = new Scene();
    const node = new Group();
    node.addComponent(Terrain, { terrainData: data, materialTemplate: new MeshStandardMaterial() });
    scene.add(node);
    const camera = new PerspectiveCamera(50);
    const runtime = start(scene, camera);
    const terrain = node.getComponent(Terrain)!;

    camera.position.set(0, 40, 0);
    runtime.update(1 / 60);
    const near = terrain.triangleCount;
    camera.position.set(0, 4000, 0);
    runtime.update(1 / 60);
    const far = terrain.triangleCount;
    expect(node.children.length).toBe(16);
    // Full detail would be 256² × 2 = 131k triangles; flat ground needs few even up close.
    expect(near).toBeLessThan(40_000);
    expect(far).toBeLessThan(near / 4);
  });

  it('meets without cracks where chunks of different detail touch', async () => {
    const hills = Array.from({ length: 257 }, (_, r) => Array.from({ length: 257 }, (_, c) => 20 * Math.exp(-((r - 128) ** 2 + (c - 128) ** 2) / 800)));
    const data = new TerrainData(await terrainFile(hills, 256, [[[255]]]));
    await loadAssets(data);
    const scene = new Scene();
    const node = new Group();
    node.addComponent(Terrain, { terrainData: data, materialTemplate: new MeshStandardMaterial() });
    scene.add(node);
    // Low over one corner: near chunks full detail, the far ones coarse.
    const camera = new PerspectiveCamera(50);
    camera.position.set(-120, 10, -120);
    start(scene, camera);
    const chunks = node.children as Mesh[];
    expect(new Set(chunks.map((c) => c.geometry.attributes.position!.count)).size).toBeGreaterThan(1);
    /** The points of a chunk on the line where its x (or z) is `at`, as text. */
    const on = (chunk: Mesh, axis: 'x' | 'z', at: number) => {
      const p = chunk.geometry.attributes.position!;
      const out: string[] = [];
      for (let i = 0; i < p.count; i++) {
        const [along, across] = axis === 'x' ? [p.getX(i), p.getZ(i)] : [p.getZ(i), p.getX(i)];
        if (Math.abs(along - at) < 1e-4) out.push(`${across},${p.getY(i).toFixed(4)}`);
      }
      return out.sort();
    };
    // Every pair of neighbours: the same points on the line they share.
    for (const chunk of chunks) {
      const [column, row] = chunk.name.split(' ')[1]!.split(',').map(Number) as [number, number];
      const right = chunks.find((c) => c.name === `chunk ${column + 1},${row}`);
      const far = chunks.find((c) => c.name === `chunk ${column},${row + 1}`);
      if (right) expect(on(right, 'x', -128 + (column + 1) * 64)).toEqual(on(chunk, 'x', -128 + (column + 1) * 64));
      if (far) expect(on(far, 'z', -128 + (row + 1) * 64)).toEqual(on(chunk, 'z', -128 + (row + 1) * 64));
    }
  });

  it('is made in code, as in Unity, and the ground follows every change', () => {
    const data = new TerrainData();
    data.heightmapResolution = 65;
    data.size = new Vector3(40, 10, 20);
    // A ramp along x: 0 at -x, all of size.y at +x.
    data.setHeights(0, 0, Array.from({ length: 65 }, () => Array.from({ length: 65 }, (_, c) => c / 64)));
    expect(data.getHeights(64, 0, 1, 1)[0]![0]).toBeCloseTo(1, 5);
    expect(data.getInterpolatedHeight(0.5, 0.5)).toBeCloseTo(5, 5);
    // Rising 10 m over 40: the normal leans back towards -x, 14° from straight up.
    expect(data.getSteepness(0.5, 0.5)).toBeCloseTo((Math.atan(10 / 40) * 180) / Math.PI, 1);

    const scene = new Scene();
    const node = new Group();
    node.addComponent(Terrain, { terrainData: data, materialTemplate: new MeshStandardMaterial() });
    scene.add(node);
    const runtime = start(scene);
    const box = () => {
      const chunk = node.children[0] as Mesh;
      chunk.geometry.computeBoundingBox();
      return chunk.geometry.boundingBox!;
    };
    expect(box().min.toArray()).toEqual([-20, 0, -10]);
    expect(box().max.x).toBe(20);
    expect(box().max.y).toBeCloseTo(10, 5);

    // Flattened to half height: the drawn ground follows at once.
    data.setHeights(0, 0, Array.from({ length: 65 }, () => Array<number>(65).fill(0.5)));
    runtime.update(1 / 60);
    expect(node.children.length).toBe(1);
    expect(box().min.y).toBeCloseTo(5, 5);
    expect(node.getComponent(Terrain)!.sampleHeight(new Vector3(3, 0, 2))).toBeCloseTo(5, 5);
  });
});

/** Start the scene, drawn with `camera` when given, and run its first frame. */
function start(scene: Scene, camera?: PerspectiveCamera): Runtime {
  const runtime = new Runtime(scene);
  runtimes.push(runtime);
  if (camera) provideCamera(runtime, () => camera);
  wake(scene);
  runtime.update(1 / 60);
  return runtime;
}
