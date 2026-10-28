import { Box3, Matrix4, Vector2, Vector3, type Mesh, type Object3D } from 'three';
import type { Body, Fixture, Shape } from 'planck';
import { Behaviour, service, writtenOf } from '@scenoco-three/core';
import { Physics2D, checkLayer, layerFilter } from './Physics2D.js';
import type { PhysicsMaterial2D } from './PhysicsMaterial2D.js';
import { Rigidbody2D } from './Rigidbody2D.js';
import type { ShapeFrame } from './transform.js';

/**
 * Unity's `Collider2D`: a 2D shape in the XY plane. With a `Rigidbody2D` on its node or a parent's it
 * shapes that body — colliders on child nodes make one compound body with it; without one it is
 * static, and moving its node still moves it, as in Unity. Sizes are scaled by the node's world
 * scale; a size left out fits the meshes on and under the node, as Unity's fit their sprite.
 */
export abstract class Collider2D extends Behaviour {
  /** Reports `onTriggerEnter2D`/`Exit2D` instead of colliding. */
  isTrigger = false;
  /** Where the shape sits on its node, before scale. */
  offset = new Vector2();
  /** Kilograms per square metre: the body's mass with `useAutoMass`, as in Unity. */
  density = 1;

  private _layer = 0;
  private _friction = 0.4;
  private _bounciness = 0;
  private _material: PhysicsMaterial2D | null = null;

  /** @internal the body the fixtures are on: the Rigidbody2D's, or one of its own when static. */ _body: Body | null = null;
  /** @internal a static body this collider made for itself, having no Rigidbody2D. */ _ownBody = false;
  /** @internal */ _fixtures: Fixture[] = [];
  /** @internal where the shape was placed in its body, to see when its node moved or scaled. */ _frame: ShapeFrame | null = null;
  /** @internal */ _physics: Physics2D | null = null;

  /**
   * Its physics layer, 0 to 15 — Unity's `gameObject.layer`, as the colliders see it. Two layers
   * `Physics2D.ignoreLayerCollision` names pass through each other.
   */
  get layer(): number {
    return this._layer;
  }
  set layer(value: number) {
    checkLayer(value);
    this._layer = value;
    const filter = layerFilter(value);
    for (const fixture of this._fixtures) fixture.setFilterData({ groupIndex: filter.filterGroupIndex, categoryBits: filter.filterCategoryBits, maskBits: filter.filterMaskBits });
  }

  /** Resistance to sliding: 0 is ice. This collider's own, when it has no `material`. */
  get friction(): number {
    return this._material?.friction ?? this._friction;
  }
  set friction(value: number) {
    this._friction = value;
    this.applySurface();
  }

  /** 0 stops dead, 1 bounces back as high. This collider's own, when it has no `material`. */
  get bounciness(): number {
    return this._material?.bounciness ?? this._bounciness;
  }
  set bounciness(value: number) {
    this._bounciness = value;
    this.applySurface();
  }

  /** A surface shared with other colliders — Unity's `sharedMaterial`. When set, it is used instead of this collider's own. */
  get material(): PhysicsMaterial2D | null {
    return this._material;
  }
  set material(value: PhysicsMaterial2D | null) {
    this._material = value;
    this.applySurface();
  }

  /** The body this collider shapes — the nearest `Rigidbody2D` on its node or above — or null for a static collider. */
  get attachedRigidbody(): Rigidbody2D | null {
    return this._node ? this.getComponentInParent(Rigidbody2D) : null;
  }

  /** planck's fixtures for this shape — more than one for a concave polygon. */
  get planckFixtures(): readonly Fixture[] {
    return this._fixtures;
  }

  /** @internal the shape, in its body's space, placed by `frame`. */
  abstract shapes(frame: ShapeFrame): Shape[];

  /** @internal take what was left out from the meshes' bounds, in the node's space. Fits nothing by default. */
  protected fit(_bounds: Box3, _written: ReadonlySet<string>): void {}

  /** The bounds' centre, unless `offset` was written. */
  protected fitOffset(bounds: Box3, written: ReadonlySet<string>): void {
    if (written.has('offset')) return;
    const centre = bounds.getCenter(SCRATCH);
    this.offset.set(centre.x, centre.y);
  }

  // `start`, not `awake`: by then every behaviour on the node is awake — a Rigidbody2D written after
  // its collider already has its body — and a model shown in `awake` is there to fit.
  override start(): void {
    const bounds = meshBounds(this.node);
    if (bounds) this.fit(bounds, new Set(writtenOf(this)));
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

  /** @internal the fixtures made again — after the node moved within its body, or was scaled. */
  _rebuild(): void {
    if (!this._body) return;
    const physics = this._physics!;
    physics.destroyFixtures(this);
    physics.createFixtures(this, this._body);
    this.attachedRigidbody?._refreshMass();
  }

  /** @internal onto a body: its Rigidbody2D's, or a static one of its own. */
  _add(): void {
    this.add();
  }

  /** @internal off its body; its own static body goes with it. */
  _remove(): void {
    this.remove();
  }

  private add(): void {
    if (this._body || !this.enabled) return;
    const physics = (this._physics = service(this.node, Physics2D));
    const rigidbody = this.attachedRigidbody;
    if (rigidbody && !rigidbody.planckBody) return; // the body is not awake yet: it takes its colliders when it is
    const body = rigidbody?.planckBody ?? physics.createStaticBody(this);
    this._ownBody = !rigidbody;
    physics.createFixtures(this, body);
    rigidbody?._refreshMass();
  }

  private remove(): void {
    const physics = this._physics;
    if (!physics || !this._body) return;
    const rigidbody = this._ownBody ? null : (this._body.getUserData() as Rigidbody2D | null);
    physics.destroyFixtures(this);
    if (this._ownBody) physics.destroyStaticBody(this);
    this._body = null;
    this._ownBody = false;
    if (rigidbody?.planckBody) rigidbody._refreshMass();
  }

  private applySurface(): void {
    for (const fixture of this._fixtures) {
      fixture.setFriction(this.friction);
      fixture.setRestitution(this.bounciness);
    }
  }
}

const SCRATCH = new Vector3();

/** The meshes on and under a node, as a box in the node's own space — what a size left out fits. */
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
