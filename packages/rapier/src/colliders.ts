import RAPIER from '@dimforge/rapier3d-compat';
import { Box3, BufferGeometry, Matrix4, Quaternion, Vector3, type Mesh, type Object3D } from 'three';
import { Behaviour, service, writtenOf, type Event } from '@scenoco-three/core';
import { Physics, checkLayer, collisionGroups } from './Physics.js';
import { PhysicsMaterialCombine, type PhysicsMaterial } from './PhysicsMaterial.js';
import { Rigidbody } from './Rigidbody.js';

/**
 * Unity's `Collider`: a shape. With a `Rigidbody` on its node or a parent's it shapes that body —
 * colliders on child nodes make one compound body with it, as in Unity; without one it is static — a floor, a wall, a coin — and moving its node still moves it, as in Unity.
 * Sizes are scaled by the node's world scale, as Unity scales them, so `<BoxCollider />` on a
 * mesh scaled to 4 is 4 wide.
 *
 * A size left out fits the meshes on and under the node, as Unity's colliders fit their mesh:
 * `<BoxCollider />` on a letter of text is the letter's box, `center` included. Written, it is kept.
 */
export abstract class Collider extends Behaviour {
  /** Reports `onTriggerEnter`/`Exit` instead of colliding. */
  isTrigger = false;
  /** Offset from the node, before scale. */
  center = new Vector3();
  /** Kilograms per cubic metre: with the size, the body's mass. */
  density = 1;

  private _layer = 0;

  /**
   * Its physics layer, 0 to 15 — Unity's `gameObject.layer`, as the colliders see it. Two layers
   * `Physics.ignoreLayerCollision` names pass through each other.
   */
  get layer(): number {
    return this._layer;
  }
  set layer(value: number) {
    checkLayer(value);
    this._layer = value;
    this._collider?.setCollisionGroups(collisionGroups(value));
  }

  /** @internal */ _collider: RAPIER.Collider | null = null;
  /** @internal the node's world scale the shape was made at. */ readonly _builtScale = new Vector3();
  /** @internal */ _physics: Physics | null = null;
  /** @internal on a child of its body's node: its pose in the body, as last given to Rapier. */
  readonly _mount = { p: new Vector3(), q: new Quaternion() };

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

  /** The body this collider shapes — the nearest `Rigidbody` on its node or above — or null for a static collider. */
  get attachedRigidbody(): Rigidbody | null {
    return this._node ? this.getComponentInParent(Rigidbody) : null;
  }

  /** @internal the shape at this world scale. */
  abstract shape(scale: Vector3): RAPIER.ColliderDesc;

  /**
   * @internal the live shape resized to this world scale, in place — what a shape with a size of a
   * few numbers can do. False when it cannot, and the shape is made again instead.
   */
  _resize(_created: RAPIER.Collider, _scale: Vector3): boolean {
    return false;
  }

  // `start`, not `awake`: by then every behaviour on the node is awake, so a Rigidbody written
  // after its collider already has its body, and a model shown in `awake` is there to fit.
  override start(): void {
    const bounds = meshBounds(this.node);
    if (bounds) this.fit(bounds, new Set(writtenOf(this)));
    this.add();
  }

  /** @internal take what was left out from the meshes' bounds, in the node's space. Fits nothing by default. */
  protected fit(_bounds: Box3, _written: ReadonlySet<string>): void {}

  /** The bounds' centre, unless `center` was written. */
  protected fitCenter(bounds: Box3, written: ReadonlySet<string>): void {
    if (!written.has('center')) bounds.getCenter(this.center);
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
    this._collider = this._physics.createCollider(this, this._ownBody(this._physics));
  }

  /** @internal a body this collider carries itself, with no `Rigidbody`: a `CharacterController`'s. */
  _ownBody(_physics: Physics): RAPIER.RigidBody | null {
    return null;
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
  /** Full size, as in Unity — not half. Left out, the mesh's. */
  size = new Vector3(1, 1, 1);

  protected override fit(bounds: Box3, written: ReadonlySet<string>): void {
    if (written.has('size')) return;
    bounds.getSize(this.size);
    this.fitCenter(bounds, written);
  }

  shape(scale: Vector3): RAPIER.ColliderDesc {
    return RAPIER.ColliderDesc.cuboid((this.size.x * scale.x) / 2, (this.size.y * scale.y) / 2, (this.size.z * scale.z) / 2);
  }

  override _resize(created: RAPIER.Collider, scale: Vector3): boolean {
    created.setHalfExtents({ x: (this.size.x * scale.x) / 2, y: (this.size.y * scale.y) / 2, z: (this.size.z * scale.z) / 2 });
    return true;
  }
}

export class SphereCollider extends Collider {
  /** Left out, half the mesh's largest side. */
  radius = 0.5;

  protected override fit(bounds: Box3, written: ReadonlySet<string>): void {
    if (written.has('radius')) return;
    const size = bounds.getSize(new Vector3());
    this.radius = Math.max(size.x, size.y, size.z) / 2;
    this.fitCenter(bounds, written);
  }

  shape(scale: Vector3): RAPIER.ColliderDesc {
    return RAPIER.ColliderDesc.ball(this.radius * Math.max(scale.x, scale.y, scale.z));
  }

  override _resize(created: RAPIER.Collider, scale: Vector3): boolean {
    created.setRadius(this.radius * Math.max(scale.x, scale.y, scale.z));
    return true;
  }
}

/** Upright, as Unity's default. `height` is the whole capsule, caps included. */
export class CapsuleCollider extends Collider {
  /** Left out, half the mesh's wider side across. */
  radius = 0.5;
  /** Left out, the mesh's height. */
  height = 2;

  protected override fit(bounds: Box3, written: ReadonlySet<string>): void {
    const size = bounds.getSize(new Vector3());
    if (!written.has('radius')) this.radius = Math.max(size.x, size.z) / 2;
    if (!written.has('height')) this.height = size.y;
    if (!written.has('radius') || !written.has('height')) this.fitCenter(bounds, written);
  }

  shape(scale: Vector3): RAPIER.ColliderDesc {
    const { half, radius } = capsuleSize(this.radius, this.height, scale);
    return RAPIER.ColliderDesc.capsule(half, radius);
  }

  override _resize(created: RAPIER.Collider, scale: Vector3): boolean {
    const { half, radius } = capsuleSize(this.radius, this.height, scale);
    created.setRadius(radius);
    created.setHalfHeight(half);
    return true;
  }
}

/** @internal an upright capsule's half height between its caps, and its radius, at a world scale. */
export function capsuleSize(radius: number, height: number, scale: Vector3): { half: number; radius: number } {
  const r = radius * Math.max(scale.x, scale.z);
  return { half: Math.max((height * scale.y) / 2 - r, 0), radius: r };
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
    return RAPIER.ColliderDesc.heightfield(n - 1, n - 1, heights, { x: size.x * scale.x, y: scale.y, z: size.z * scale.z });
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
    return RAPIER.ColliderDesc.trimesh(positions, indices);
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

/** Every mesh on and under `node`, bounded in `node`'s own space; null when there is none. */
function meshBounds(node: Object3D): Box3 | null {
  node.updateWorldMatrix(true, true);
  const toNode = new Matrix4().copy(node.matrixWorld).invert();
  const bounds = new Box3();
  const box = new Box3();
  const local = new Matrix4();
  node.traverse((child) => {
    const geometry = (child as Mesh).isMesh ? (child as Mesh).geometry : null;
    if (!geometry) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    bounds.union(box.copy(geometry.boundingBox!).applyMatrix4(local.multiplyMatrices(toNode, child.matrixWorld)));
  });
  return bounds.isEmpty() ? null : bounds;
}

