import RAPIER from '@dimforge/rapier3d-compat';
import { BufferGeometry, Matrix4, Vector3, type Mesh, type Object3D } from 'three';
import { Behaviour, service, type Event } from '@scenoco-three/core';
import { Physics } from './Physics.js';
import { PhysicsMaterialCombine, type PhysicsMaterial } from './PhysicsMaterial.js';
import { Rigidbody } from './Rigidbody.js';

/**
 * Unity's `Collider`: a shape. With a `Rigidbody` on the same node it shapes that body; without
 * one it is static — a floor, a wall, a coin — and moving its node still moves it, as in Unity.
 * Sizes are scaled by the node's world scale, as Unity scales them, so `<BoxCollider />` on a
 * mesh scaled to 4 is 4 wide.
 */
export abstract class Collider extends Behaviour {
  /** Reports `onTriggerEnter`/`Exit` instead of colliding. */
  isTrigger = false;
  /** Offset from the node, before scale. */
  center = new Vector3();
  /** Kilograms per cubic metre: with the size, the body's mass. */
  density = 1;

  /** @internal */ _collider: RAPIER.Collider | null = null;
  /** @internal */ _physics: Physics | null = null;

  private _friction = 0.5;
  private _bounciness = 0;
  private _material: PhysicsMaterial | null = null;

  /** Resistance to sliding: 0 is ice. This collider's own, when it has no `material`. */
  get friction(): number {
    return this._friction;
  }
  set friction(value: number) {
    this._friction = value;
    this._applySurface();
  }

  /** 0 stops dead, 1 bounces back as high. This collider's own, when it has no `material`. */
  get bounciness(): number {
    return this._bounciness;
  }
  set bounciness(value: number) {
    this._bounciness = value;
    this._applySurface();
  }

  /**
   * A surface shared with other colliders, with its combine modes — Unity's `sharedMaterial`. When
   * set, it is used instead of this collider's `friction` and `bounciness`.
   */
  get material(): PhysicsMaterial | null {
    return this._material;
  }
  set material(value: PhysicsMaterial | null) {
    this._material?._users.delete(this);
    this._material = value;
    if (value && this._collider) value._users.add(this);
    this._applySurface();
  }

  /** @internal what a contact with this collider uses. */
  _surface(): { friction: number; bounciness: number; frictionCombine: PhysicsMaterialCombine; bounceCombine: PhysicsMaterialCombine } {
    const m = this._material;
    return m ?? { friction: this._friction, bounciness: this._bounciness, frictionCombine: PhysicsMaterialCombine.Average, bounceCombine: PhysicsMaterialCombine.Average };
  }

  /** @internal the surface, onto the live Rapier collider. Rapier's combine rules share Unity's order. */
  _applySurface(): void {
    const c = this._collider;
    if (!c) return;
    const s = this._surface();
    c.setFriction(s.friction);
    c.setRestitution(s.bounciness);
    c.setFrictionCombineRule(s.frictionCombine as number as RAPIER.CoefficientCombineRule);
    c.setRestitutionCombineRule(s.bounceCombine as number as RAPIER.CoefficientCombineRule);
  }

  /**
   * The Rapier collider, once this has started — for Rapier's own API: the character controller,
   * query filters. `physics.colliderOf()` turns one back into this.
   */
  get rapierCollider(): RAPIER.Collider | null {
    return this._collider;
  }

  /** The body this collider shapes, or null for a static collider. */
  get attachedRigidbody(): Rigidbody | null {
    return this._node ? this.getComponent(Rigidbody) : null;
  }

  /** @internal the shape at this world scale. */
  abstract shape(scale: Vector3): RAPIER.ColliderDesc;

  // `start`, not `awake`: by then every behaviour on the node is awake, so a Rigidbody written
  // after its collider already has its body.
  override start(): void {
    this.add();
  }

  override onEnable(): void {
    if (this._started) this.add();
  }

  override onDisable(): void {
    this.remove();
  }

  override onDestroy(): void {
    this.remove();
  }

  /** The shape made again — after what it is made from changed. */
  protected rebuild(): void {
    if (!this._started || !this.enabled) return;
    this.remove();
    this.add();
  }

  private add(): void {
    this._material?._users.add(this);
    const rigidbody = this.attachedRigidbody;
    if (rigidbody) return rigidbody.attach(this);
    if (this._collider) return;
    this._physics = service(this.node, Physics);
    this._collider = this._physics.createCollider(this, null);
  }

  private remove(): void {
    this._material?._users.delete(this);
    const rigidbody = this.attachedRigidbody;
    if (rigidbody) rigidbody.detach(this);
    else if (this._collider) this._physics?.destroyCollider(this._collider);
    this._collider = null;
  }
}

export class BoxCollider extends Collider {
  /** Full size, as in Unity — not half. */
  size = new Vector3(1, 1, 1);

  shape(scale: Vector3): RAPIER.ColliderDesc {
    return RAPIER.ColliderDesc.cuboid((this.size.x * scale.x) / 2, (this.size.y * scale.y) / 2, (this.size.z * scale.z) / 2);
  }
}

export class SphereCollider extends Collider {
  radius = 0.5;

  shape(scale: Vector3): RAPIER.ColliderDesc {
    return RAPIER.ColliderDesc.ball(this.radius * Math.max(scale.x, scale.y, scale.z));
  }
}

/** Upright, as Unity's default. `height` is the whole capsule, caps included. */
export class CapsuleCollider extends Collider {
  radius = 0.5;
  height = 2;

  shape(scale: Vector3): RAPIER.ColliderDesc {
    const radius = this.radius * Math.max(scale.x, scale.z);
    const half = Math.max((this.height * scale.y) / 2 - radius, 0);
    return RAPIER.ColliderDesc.capsule(half, radius);
  }
}

/**
 * What `TerrainCollider` reads: `@scenoco-three/terrain`'s `TerrainData` has this shape. Heights in
 * metres, row by row from -z, `heightmapResolution` a side, corner to corner over `size.x` × `size.z`
 * centred on the node.
 */
export interface TerrainHeights {
  readonly url: string;
  readonly isLoaded: boolean;
  readonly heightmapResolution: number;
  readonly size: Vector3;
  readonly heights: Float32Array;
  /** Raised when the heights or the size change: the collider is made again. */
  readonly changed: Event<[]>;
}

/**
 * Unity's `TerrainCollider`: the ground of a `TerrainData` as a static heightfield, on the node the
 * `Terrain` is on. Static only — a terrain does not move.
 *
 * ```tsx
 * <Group scale={0.25}>
 *   <Terrain terrainData={terrains.meadow} />
 *   <TerrainCollider terrainData={terrains.meadow} />
 * </Group>
 * ```
 */
export class TerrainCollider extends Collider {
  terrainData: TerrainHeights | null = null;

  private dirty = false;

  override start(): void {
    super.start();
    // Made again once, before the world next steps, however many changes came first.
    if (this.terrainData) this.listen(this.terrainData.changed, () => (this.dirty = true));
  }

  override fixedUpdate(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.rebuild();
  }

  shape(scale: Vector3): RAPIER.ColliderDesc {
    const data = this.terrainData;
    if (!data?.isLoaded) throw new Error(`TerrainCollider needs terrainData={…}, loaded with loadAssets${data ? `: "${data.url}" is not` : ''}.`);
    const n = data.heightmapResolution;
    // Rapier's heightfield is column-major: the sample at row r (along z), column c (along x) is r + c * n.
    const heights = new Float32Array(n * n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) heights[r + c * n] = data.heights[r * n + c]!;
    const size = data.size;
    // Internal edges fixed, as PhysX does by default: a body rolling across the triangles meets one
    // smooth surface, not the ridge of every edge it crosses — which kicks it into small hops.
    return RAPIER.ColliderDesc.heightfield(n - 1, n - 1, heights, { x: size.x * scale.x, y: scale.y, z: size.z * scale.z }, RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES);
  }
}

/**
 * Unity's `MeshCollider`: the shape of a mesh. `convex` wraps it in its convex hull — what a moving
 * body needs, as in Unity; without it the triangles themselves, for static ground, walls and rocks.
 * The mesh is `sharedMesh` when given, else every mesh under the node, as placed under it.
 *
 * ```tsx
 * <Mesh geometry={rock} material={stone}>
 *   <Rigidbody />
 *   <MeshCollider convex />
 * </Mesh>
 * ```
 */
export class MeshCollider extends Collider {
  sharedMesh: BufferGeometry | null = null;
  /** The convex hull: needed on a body that moves. */
  convex = false;

  shape(scale: Vector3): RAPIER.ColliderDesc {
    const { positions, indices } = this.gather();
    for (let i = 0; i < positions.length; i += 3) {
      positions[i]! *= scale.x;
      positions[i + 1]! *= scale.y;
      positions[i + 2]! *= scale.z;
    }
    if (this.convex) {
      const hull = RAPIER.ColliderDesc.convexHull(positions);
      if (!hull) throw new Error(`MeshCollider on "${this.node.name}": its mesh is flat or empty, and has no convex hull.`);
      return hull;
    }
    if (this.attachedRigidbody && !this.attachedRigidbody.isKinematic) {
      throw new Error(`MeshCollider on "${this.node.name}": a moving body needs convex, as in Unity — <MeshCollider convex />.`);
    }
    // Internal edges fixed (merging the duplicate vertices a model's UV seams leave), as PhysX does by default.
    return RAPIER.ColliderDesc.trimesh(positions, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES);
  }

  /** The mesh's points and triangles in the node's own space, before its scale: shape() applies that, as for every collider. */
  private gather(): { positions: Float32Array; indices: Uint32Array } {
    const parts: { geometry: BufferGeometry; matrix: Matrix4 }[] = [];
    if (this.sharedMesh) {
      parts.push({ geometry: this.sharedMesh, matrix: new Matrix4() });
    } else {
      this.node.updateWorldMatrix(true, true);
      const toNode = new Matrix4().copy(this.node.matrixWorld).invert();
      this.node.traverse((object: Object3D) => {
        const mesh = object as Mesh;
        if (mesh.isMesh && mesh.geometry) parts.push({ geometry: mesh.geometry, matrix: new Matrix4().multiplyMatrices(toNode, mesh.matrixWorld) });
      });
    }
    if (parts.length === 0) throw new Error(`MeshCollider on "${this.node.name}": no mesh under it, and no sharedMesh.`);
    const positions: number[] = [];
    const indices: number[] = [];
    const point = new Vector3();
    for (const { geometry, matrix } of parts) {
      const position = geometry.getAttribute('position');
      const first = positions.length / 3;
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i).applyMatrix4(matrix);
        positions.push(point.x, point.y, point.z);
      }
      const index = geometry.getIndex();
      if (index) for (let i = 0; i < index.count; i++) indices.push(first + index.getX(i));
      else for (let i = 0; i < position.count; i++) indices.push(first + i);
    }
    return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
  }
}
