import { afterEach, describe, expect, it } from 'vitest';
import { BoxGeometry, BufferAttribute, Group, Mesh, MeshStandardMaterial, Scene, Vector3, type Material } from 'three';
import { Model, Runtime, loadAssets, ref, wake } from '@scenoco-three/core';
import { SplineAnimate, SplineContainer, SplineExtrude, SplineInstantiate, SplineMesh, Spline, SplineUtility } from '@scenoco-three/splines';

const runtimes: Runtime[] = [];
afterEach(() => runtimes.splice(0).forEach((r) => r.dispose()));

/** Start the scene and run it for `seconds` (at least one frame, which is the one `start` runs in). */
function run(scene: Scene, seconds = 0, dt = 1 / 60): Runtime {
  const runtime = new Runtime(scene);
  runtimes.push(runtime);
  wake(scene);
  for (let i = Math.max(1, Math.round(seconds / dt)); i > 0; i--) runtime.update(dt);
  return runtime;
}

const close = (v: Vector3, x: number, y: number, z: number, digits = 3) => {
  expect(v.x).toBeCloseTo(x, digits);
  expect(v.y).toBeCloseTo(y, digits);
  expect(v.z).toBeCloseTo(z, digits);
};

describe('splines', () => {
  it('evaluates by length, banks by roll, and finds the nearest point', () => {
    const line = new Spline([[0, 0, 0], [10, 0, 0], [30, 0, 0]]);
    expect(line.getLength()).toBeCloseTo(30, 3);
    close(line.evaluatePosition(0.5), 15, 0, 0, 1);
    close(line.evaluateTangent(0.5), 1, 0, 0);
    close(line.evaluateUpVector(0.5), 0, 1, 0);

    const banked = new Spline([{ position: [0, 0, 0], roll: Math.PI / 2 }, { position: [10, 0, 0], roll: Math.PI / 2 }]);
    close(banked.evaluateUpVector(0.5), 0, 0, 1);

    const nearest = SplineUtility.getNearestPoint(line, new Vector3(20, 5, 0));
    expect(nearest.t).toBeCloseTo(20 / 30, 2);
    expect(nearest.distance).toBeCloseTo(5, 2);
  });

  it('evaluates in world space, through its node', () => {
    const track = ref<Group>();
    const scene = (
      <Scene>
        <Group ref={track} position={[0, 2, 0]} scale={2}>
          <SplineContainer knots={[[0, 0, 0], [5, 0, 0]]} />
        </Group>
      </Scene>
    ) as Scene;
    run(scene);
    const container = track.current!.getComponent(SplineContainer)!;
    close(container.evaluatePosition(1), 10, 2, 0);
    expect(container.calculateLength()).toBeCloseTo(10, 3);
  });

  it('extrudes a tube around the spline, wound outward, with rings by length', () => {
    const scene = (
      <Scene>
        <Mesh>
          <SplineContainer knots={[[0, 0, 0], [0, 0, -10]]} />
          <SplineExtrude radius={1} sides={8} segmentsPerUnit={1} capped={false} />
        </Mesh>
      </Scene>
    ) as Scene;
    run(scene);
    const geometry = (scene.children[0] as Mesh).geometry;
    expect(geometry.getAttribute('position').count).toBe(11 * 9);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.max.x - geometry.boundingBox!.min.x).toBeCloseTo(2, 3);
    // Every face's normal, from its winding, points away from the spline's axis.
    const p = geometry.getAttribute('position');
    const index = geometry.getIndex()!;
    for (let k = 0; k < index.count; k += 3) {
      const [a, b, c] = [0, 1, 2].map((o) => new Vector3().fromBufferAttribute(p, index.getX(k + o)));
      const face = new Vector3().subVectors(b!, a!).cross(new Vector3().subVectors(c!, a!));
      const outward = new Vector3(a!.x + b!.x + c!.x, a!.y + b!.y + c!.y, 0);
      expect(face.dot(outward)).toBeGreaterThan(0);
    }
  });

  it('places prefabs by spacing, facing along the spline, offset to its right', () => {
    const Post = () => <Group />;
    const holder = ref<Group>();
    const scene = (
      <Scene>
        <Group ref={holder}>
          <SplineContainer knots={[[0, 0, 0], [0, 0, -12]]} />
          <SplineInstantiate itemsToInstantiate={[Post]} spacing={4} positionOffset={[1, 0, 0]} />
        </Group>
      </Scene>
    ) as Scene;
    run(scene);
    const posts = holder.current!.getComponent(SplineInstantiate)!.instances;
    expect(posts).toHaveLength(4);
    // Along -Z, the right is +X; the copy's +Z faces along the spline.
    close(posts[1]!.position, 1, 0, -4);
    close(new Vector3(0, 0, 1).applyQuaternion(posts[1]!.quaternion), 0, 0, -1);
  });

  it('moves along the spline at its speed, and stops at the end once', () => {
    const car = ref<Group>();
    const track = ref<Group>();
    const scene = (
      <Scene>
        <Group ref={track}>
          <SplineContainer knots={[[0, 0, 0], [20, 0, 0]]} />
        </Group>
        <Group ref={car}>
          <SplineAnimate container={track} animationMethod="speed" maxSpeed={10} loop="once" />
        </Group>
      </Scene>
    ) as Scene;
    const runtime = run(scene, 0.5, 0.05);
    expect(car.current!.position.x).toBeCloseTo(5, 0);
    const animate = car.current!.getComponent(SplineAnimate)!;
    let done = 0;
    animate.completed.on(() => done++);
    for (let i = 0; i < 60; i++) runtime.update(0.05);
    expect(car.current!.position.x).toBeCloseTo(20, 3);
    expect(animate.isPlaying).toBe(false);
    expect(done).toBe(1);
  });

  it('bends a piece along the spline, a whole number of copies end to end', () => {
    const piece = new BoxGeometry(2, 0.2, 5).translate(0, 0, 2.5);
    const scene = (
      <Scene>
        <Mesh>
          <SplineContainer knots={[[0, 0, 0], [20, 0, 0]]} />
          <SplineMesh mesh={piece} />
        </Mesh>
      </Scene>
    ) as Scene;
    run(scene);
    const geometry = (scene.children[0] as Mesh).geometry;
    expect(geometry.getAttribute('position').count).toBe(piece.getAttribute('position').count * 4);
    geometry.computeBoundingBox();
    close(geometry.boundingBox!.min, 0, -0.1, -1);
    close(geometry.boundingBox!.max, 20, 0.1, 1);
  });

  it('bends every mesh of a model, each keeping its own material, quantized as gltfpack writes it', async () => {
    // The slab as KHR_mesh_quantization stores it: normalized 16-bit positions in -1..1, scaled up by the node.
    const slabGeometry = new BoxGeometry(10, 0.2, 4).translate(0, -0.1, 2);
    const plain = slabGeometry.getAttribute('position');
    const quantized = new Int16Array(plain.count * 3).map((_, i) => Math.round((plain.array[i]! / 5) * 32767));
    slabGeometry.setAttribute('position', new BufferAttribute(quantized, 3, true));
    const slab = new Mesh(slabGeometry, new MeshStandardMaterial({ color: '#333' }));
    slab.scale.setScalar(5);
    const kerb = new Mesh(new BoxGeometry(0.5, 0.2, 4).translate(0, 0.1, 2), new MeshStandardMaterial({ color: '#d22' }));
    kerb.position.x = 5;
    const root = new Group();
    root.add(slab, kerb);
    class Piece extends Model {
      protected override async fetch() {
        return { scene: root };
      }
    }
    const piece = new Piece('/piece.glb');
    await loadAssets(piece);
    const scene = (
      <Scene>
        <Mesh>
          <SplineContainer knots={[[0, 0, 0], [0, 0, 16]]} />
          <SplineMesh mesh={piece} />
        </Mesh>
      </Scene>
    ) as Scene;
    run(scene);
    const road = scene.children[0] as Mesh;
    expect((road.material as Material[]).map((m) => m.uuid)).toEqual([slab.material.uuid, kerb.material.uuid]);
    expect(road.geometry.groups).toHaveLength(2);
    // Along +Z the left is +X: the kerb, modelled at +X, stays on the left, 4 copies long.
    road.geometry.computeBoundingBox();
    expect(road.geometry.boundingBox!.max.x).toBeCloseTo(5.25, 3);
    // The quantized slab keeps its 10 m: its far edge, clipped to -1 if the transform were written into -1..1.
    expect(road.geometry.boundingBox!.min.x).toBeCloseTo(-5, 3);
    expect(road.geometry.boundingBox!.max.z).toBeCloseTo(16, 3);
  });
});
