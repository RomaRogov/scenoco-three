import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
} from 'three';

/**
 * The whole prototype, in one file.
 *
 * Sizes follow three.js's own defaults, which are not Unity's — a BoxGeometry(1, 1, 1) is one
 * unit on a side, a CylinderGeometry(0.5, 0.5, 2) is one across and two tall, and a node's
 * position is the *middle* of it, so a 1-tall cube resting on the ground sits at y = 0.5.
 */
export class Prototype {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(45, 1, 0.1, 200);

  readonly block: Mesh;

  /** Degrees per second the block turns. */
  spin = 45;

  constructor() {
    this.scene.background = new Color('#0b1120');
    this.camera.position.set(0, 3, 7);
    this.camera.rotation.x = (-15 * Math.PI) / 180;

    this.scene.add(new AmbientLight(new Color('#9db8d8'), 0.7));
    const sun = new DirectionalLight(new Color('#fff4e0'), 2);
    sun.position.set(4, 8, 5);
    this.scene.add(sun);

    // The ground: a 10 x 10 plane, laid flat and scaled to 40 across.
    const ground = new Mesh(
      new PlaneGeometry(10, 10),
      new MeshStandardMaterial({ color: new Color('#2a3b4d'), roughness: 0.9 }),
    );
    ground.rotation.x = (-90 * Math.PI) / 180;
    ground.scale.setScalar(4);
    ground.name = 'ground';
    this.scene.add(ground);

    // A 1 x 1 x 1 cube, resting on the ground, turning.
    this.block = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({ color: new Color('#e9c46a'), roughness: 0.5, metalness: 0.1 }),
    );
    this.block.position.y = 0.5;
    this.block.name = 'block';
    this.scene.add(this.block);
  }

  /** One frame. `dt` is seconds. */
  step(dt: number): void {
    this.block.rotation.y += ((this.spin * Math.PI) / 180) * dt;
  }

  dispose(): void {
    this.scene.clear();
  }
}
