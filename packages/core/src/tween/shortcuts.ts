import { Light, Material, Object3D, OrthographicCamera, PerspectiveCamera, type Camera, type Color, type Euler, type Quaternion, type Vector3 } from 'three';
import { Tween, installNodeTweens, tweenProperty, type RotateMode } from '@scenoco/kernel';

/**
 * DOTween's shortcuts on three.js's classes. The node's — `doMove`, `doRotate`, `doPunchScale`… — are
 * the kernel's, installed on `Object3D`; three.js's own kinds of thing — a material's colour and fade,
 * a light's intensity, a camera's lens — are tweened here, by property.
 */
installNodeTweens(Object3D.prototype);

function colorOf(target: object, to: Color, d: number): Tween {
  if (!(target as { color?: unknown }).color) throw new Error(`doColor: a ${target.constructor.name} has no color.`);
  return tweenProperty(target, 'color', to, d);
}

Object.assign(Material.prototype, {
  doColor(this: Material, to: Color, d: number) {
    return colorOf(this, to, d);
  },
  /** Opacity shows only on a transparent material, so a fade makes it one. */
  doFade(this: Material, to: number, d: number) {
    if (!this.transparent) {
      this.transparent = true;
      this.needsUpdate = true;
    }
    return tweenProperty(this, 'opacity', to, d);
  },
  doFloat(this: Material, to: number, property: string, d: number) {
    return tweenProperty(this, property, to, d);
  },
});

Object.assign(Light.prototype, {
  doColor(this: Light, to: Color, d: number) {
    return colorOf(this, to, d);
  },
  doIntensity(this: Light, to: number, d: number) {
    return tweenProperty(this, 'intensity', to, d);
  },
});

const projected = (camera: Camera, tween: Tween) => tween.setTarget(camera).setLink(camera);

Object.assign(PerspectiveCamera.prototype, {
  doFieldOfView(this: PerspectiveCamera, to: number, d: number) {
    return projected(this, Tween.to(() => this.fov, (v) => {
      this.fov = v;
      this.updateProjectionMatrix();
    }, to, d));
  },
});

Object.assign(OrthographicCamera.prototype, {
  /** Unity's orthographic size: half the height it shows. The width keeps to it. */
  doOrthoSize(this: OrthographicCamera, to: number, d: number) {
    return projected(this, Tween.to(() => (this.top - this.bottom) / 2, (v) => {
      const k = v / ((this.top - this.bottom) / 2);
      const [cx, cy] = [(this.left + this.right) / 2, (this.top + this.bottom) / 2];
      this.left = cx + (this.left - cx) * k;
      this.right = cx + (this.right - cx) * k;
      this.top = cy + (this.top - cy) * k;
      this.bottom = cy + (this.bottom - cy) * k;
      this.updateProjectionMatrix();
    }, to, d));
  },
});

declare module 'three' {
  interface Object3D {
    /** Move to a world position. */
    doMove(to: Vector3, duration: number): Tween;
    doMoveX(to: number, duration: number): Tween;
    doMoveY(to: number, duration: number): Tween;
    doMoveZ(to: number, duration: number): Tween;
    /** Move to a position in the parent's space, which is three's `position`. */
    doLocalMove(to: Vector3, duration: number): Tween;
    doLocalMoveX(to: number, duration: number): Tween;
    doLocalMoveY(to: number, duration: number): Tween;
    doLocalMoveZ(to: number, duration: number): Tween;
    /** Turn to a world rotation: a `Vector3` holds degrees, an `Euler` radians. */
    doRotate(to: Vector3 | Euler, duration: number, mode?: RotateMode): Tween;
    doLocalRotate(to: Vector3 | Euler, duration: number, mode?: RotateMode): Tween;
    doRotateQuaternion(to: Quaternion, duration: number): Tween;
    doLocalRotateQuaternion(to: Quaternion, duration: number): Tween;
    /** Turn to face a world position. */
    doLookAt(point: Vector3, duration: number): Tween;
    /** To a scale: one number for all three axes. */
    doScale(to: number | Vector3, duration: number): Tween;
    doScaleX(to: number, duration: number): Tween;
    doScaleY(to: number, duration: number): Tween;
    doScaleZ(to: number, duration: number): Tween;
    /** Hop to a world position, `jumps` times, `power` high. */
    doJump(to: Vector3, power: number, jumps: number, duration: number): Tween;
    doLocalJump(to: Vector3, power: number, jumps: number, duration: number): Tween;
    /** Out by `amount` and back, swinging and dying away; ends where it began. Rotation's amounts are degrees. */
    doPunchPosition(amount: Vector3, duration: number, vibrato?: number, elasticity?: number): Tween;
    doPunchRotation(amount: Vector3, duration: number, vibrato?: number, elasticity?: number): Tween;
    doPunchScale(amount: Vector3, duration: number, vibrato?: number, elasticity?: number): Tween;
    /** Shaken at random, dying away; ends where it began. Rotation's strength is degrees. */
    doShakePosition(duration: number, strength?: number | Vector3, vibrato?: number): Tween;
    doShakeRotation(duration: number, strength?: number | Vector3, vibrato?: number): Tween;
    doShakeScale(duration: number, strength?: number | Vector3, vibrato?: number): Tween;
    /** End every tween on this node. */
    doKill(complete?: boolean): void;
    /** Every tween on this node to its end, now. */
    doComplete(): void;
  }
  interface Material {
    doColor(to: Color, duration: number): Tween;
    doFade(to: number, duration: number): Tween;
    doFloat(to: number, property: string, duration: number): Tween;
  }
  interface Light {
    doColor(to: Color, duration: number): Tween;
    doIntensity(to: number, duration: number): Tween;
  }
  interface PerspectiveCamera {
    doFieldOfView(to: number, duration: number): Tween;
  }
  interface OrthographicCamera {
    doOrthoSize(to: number, duration: number): Tween;
  }
}
