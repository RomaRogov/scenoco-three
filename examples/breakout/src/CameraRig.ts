import { MathUtils, Vector3, type PerspectiveCamera } from 'three';
import { Behaviour, Mathf, Time, findObjectOfType, findObjectsOfType } from '@scenoco-three/core';
import { Ball } from './Ball.js';
import { GameState } from './GameState.js';
import { Paddle } from './Paddle.js';

/**
 * The camera behind the paddle, looking up the field: it drifts after the paddle and the ball, so
 * the near paddle and the far bricks slide past each other — parallax — and it shakes when the game
 * hits hard. The fov keeps the field's width in view at the paddle's line, whatever the window.
 *
 * Shake is trauma, as in most action games: each impact adds to it, it decays on its own, and the
 * camera moves by its square — a light hit is a tremor, a lost ball a jolt.
 */
export class CameraRig extends Behaviour<PerspectiveCamera> {
  /** What it looks at when everything is centred. */
  target = new Vector3(0, 8, 0);
  /** How much of the paddle's sideways move the camera follows, and of the balls' average. */
  followPaddle = 0.3;
  followBall = 0.12;
  /** How quickly it catches up, per second. */
  smoothing = 3.5;
  /** The world width kept on screen at the paddle's line, and the narrowest vertical fov. */
  frameWidth = 21.5;
  minFov = 46;
  /** How far the strongest shake throws it, in world units, and how fast trauma fades per second. */
  shake = 0.55;
  recovery = 1.6;

  private readonly home = new Vector3();
  private readonly look = new Vector3();
  private drift = 0;
  private trauma = 0;
  private paddle: Paddle | null = null;

  override start(): void {
    this.home.copy(this.node.position);
    this.paddle = findObjectOfType(Paddle);
    const game = findObjectOfType(GameState);
    if (game) this.listen(game.impact, (strength) => (this.trauma = Math.min(1, this.trauma + strength)));
  }

  override lateUpdate(dt: number): void {
    const camera = this.node;
    const balls = findObjectsOfType(Ball);
    const ballX = balls.length ? balls.reduce((sum, b) => sum + b.node.position.x, 0) / balls.length : 0;
    const wanted = (this.paddle?.node.position.x ?? 0) * this.followPaddle + ballX * this.followBall;
    this.drift += (wanted - this.drift) * (1 - Math.exp(-this.smoothing * dt));

    // Unscaled: a paused game still settles its camera.
    this.trauma = Math.max(0, this.trauma - this.recovery * Time.unscaledDeltaTime);
    const jolt = this.trauma * this.trauma * this.shake;
    const t = Time.unscaledTime * 22;
    const nx = (Mathf.perlinNoise(t, 0.1) - 0.5) * 2;
    const ny = (Mathf.perlinNoise(0.7, t) - 0.5) * 2;

    camera.position.set(this.home.x + this.drift + nx * jolt, this.home.y + ny * jolt, this.home.z);
    // The eye moves more than its aim: near things slide farther than far ones.
    this.look.set(this.target.x + this.drift * 0.55, this.target.y, this.target.z);
    camera.lookAt(this.look);
    camera.rotateZ(nx * jolt * 0.05);
    this.fit();
  }

  /** The vertical fov that shows `frameWidth` at the paddle's distance, never under `minFov`. */
  private fit(): void {
    const camera = this.node;
    const distance = camera.position.distanceTo(new Vector3(this.drift, 1, 0));
    const across = 2 * Math.atan(this.frameWidth / 2 / distance);
    const fov = Math.max(this.minFov, 2 * Math.atan(Math.tan(across / 2) / camera.aspect) * MathUtils.RAD2DEG);
    if (Math.abs(fov - camera.fov) < 0.01) return;
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}
