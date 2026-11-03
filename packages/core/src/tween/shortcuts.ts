import { Camera, Color, Euler, Light, Material, Object3D, OrthographicCamera, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { Random } from '../Random.js';
import { Ease } from './Ease.js';
import { Tween } from './Tween.js';

/** How a rotation given as angles turns. */
export const RotateMode = {
  /** The short way round. */
  Fast: 0,
  /** By the angles as written, so 720° is two whole turns. */
  FastBeyond360: 1,
} as const;
export type RotateMode = (typeof RotateMode)[keyof typeof RotateMode];

const DEGREE = Math.PI / 180;

/** The moving parts of a node, in the parent's space or the world's. */
const localPosition = (n: Object3D) => ({ get: () => n.position, set: (v: Vector3) => void n.position.copy(v) });
const worldPosition = (n: Object3D) => ({
  get: () => n.getWorldPosition(new Vector3()),
  set(v: Vector3) {
    n.position.copy(v);
    if (n.parent) n.parent.worldToLocal(n.position);
  },
});
const localRotation = (n: Object3D) => ({ get: () => n.quaternion, set: (q: Quaternion) => void n.quaternion.copy(q) });
const worldRotation = (n: Object3D) => ({
  get: () => n.getWorldQuaternion(new Quaternion()),
  set(q: Quaternion) {
    n.quaternion.copy(q);
    if (n.parent) n.quaternion.premultiply(n.parent.getWorldQuaternion(new Quaternion()).invert());
  },
});
const localScale = (n: Object3D) => ({ get: () => n.scale, set: (v: Vector3) => void n.scale.copy(v) });

type Part<T> = { get(): T; set(value: T): void };

const onNode = (node: Object3D, tween: Tween) => tween.setTarget(node).setLink(node);

function move(node: Object3D, part: Part<Vector3>, to: Vector3, duration: number): Tween {
  return onNode(node, Tween.to(part.get, part.set, to, duration));
}

function axis(node: Object3D, part: Part<Vector3>, i: 0 | 1 | 2, to: number, duration: number): Tween {
  const value = new Vector3();
  return onNode(
    node,
    Tween.to(
      () => part.get().getComponent(i),
      (v) => part.set(value.copy(part.get()).setComponent(i, v)),
      to,
      duration,
    ),
  );
}

/** An angle as its type says it: a `Vector3` holds degrees, an `Euler` radians, as it does everywhere in three. */
const radians = (angles: Vector3 | Euler): Euler => ((angles as Euler).isEuler ? (angles as Euler) : new Euler().setFromVector3((angles as Vector3).clone().multiplyScalar(DEGREE)));

function rotate(node: Object3D, part: Part<Quaternion>, angles: Vector3 | Euler, duration: number, mode: RotateMode): Tween {
  const to = radians(angles);
  if (mode === RotateMode.Fast) return onNode(node, Tween.to(part.get, part.set, new Quaternion().setFromEuler(to), duration));
  const q = new Quaternion();
  const now = new Euler(0, 0, 0, to.order);
  return onNode(
    node,
    new Tween(duration, (self) => {
      const from = new Euler().setFromQuaternion(part.get(), to.order);
      const k = self.relative ? 1 : 0;
      const [x, y, z] = [to.x + from.x * k, to.y + from.y * k, to.z + from.z * k];
      return (e) => part.set(q.setFromEuler(now.set(from.x + (x - from.x) * e, from.y + (y - from.y) * e, from.z + (z - from.z) * e)));
    }),
  );
}

function jump(node: Object3D, part: Part<Vector3>, to: Vector3, power: number, jumps: number, duration: number): Tween {
  const value = new Vector3();
  return onNode(
    node,
    new Tween(duration, () => {
      const from = part.get().clone();
      return (e) => {
        value.lerpVectors(from, to, e);
        const hop = (e * jumps) % 1;
        value.y += power * 4 * hop * (1 - hop);
        part.set(value);
      };
    }),
  );
}

/** An offset that comes and goes, added to where the part was when it began. */
function wobble(node: Object3D, duration: number, begin: () => (offset: Vector3) => void, offsetAt: (e: number, out: Vector3) => void): Tween {
  const offset = new Vector3();
  return onNode(
    node,
    new Tween(duration, () => {
      const apply = begin();
      return (e) => {
        offsetAt(e, offset);
        apply(offset);
      };
    }).setEase(Ease.Linear),
  );
}

const added = (part: Part<Vector3>) => () => {
  const base = part.get().clone();
  const value = new Vector3();
  return (offset: Vector3) => part.set(value.copy(base).add(offset));
};
const turned = (part: Part<Quaternion>) => () => {
  const base = part.get().clone();
  const value = new Quaternion();
  const angles = new Euler();
  return (offset: Vector3) => part.set(value.copy(base).multiply(new Quaternion().setFromEuler(angles.set(offset.x * DEGREE, offset.y * DEGREE, offset.z * DEGREE))));
};

function punch(node: Object3D, begin: () => (offset: Vector3) => void, amount: Vector3, duration: number, vibrato: number, elasticity: number): Tween {
  return wobble(node, duration, begin, (e, out) => {
    const swing = Math.sin(e * Math.PI * vibrato * 0.5) * (1 - e);
    out.copy(amount).multiplyScalar(swing < 0 ? swing * elasticity : swing);
  });
}

function shake(node: Object3D, begin: () => (offset: Vector3) => void, strength: number | Vector3, duration: number, vibrato: number): Tween {
  const size = typeof strength === 'number' ? new Vector3(strength, strength, strength) : strength;
  const last = new Vector3();
  const next = new Vector3();
  let segment = -1;
  const pick = () => next.set((Random.value * 2 - 1) * size.x, (Random.value * 2 - 1) * size.y, (Random.value * 2 - 1) * size.z);
  return wobble(node, duration, begin, (e, out) => {
    const at = e * Math.max(1, vibrato * duration);
    if (Math.floor(at) !== segment) {
      segment = Math.floor(at);
      last.copy(next);
      pick();
    }
    out.lerpVectors(last, next, at - segment).multiplyScalar(1 - e);
  });
}

const AXES = ['X', 'Y', 'Z'] as const;
const nodes = Object3D.prototype as unknown as Record<string, unknown>;
AXES.forEach((name, i) => {
  nodes[`doMove${name}`] = function (this: Object3D, to: number, d: number) {
    return axis(this, worldPosition(this), i as 0, to, d);
  };
  nodes[`doLocalMove${name}`] = function (this: Object3D, to: number, d: number) {
    return axis(this, localPosition(this), i as 0, to, d);
  };
  nodes[`doScale${name}`] = function (this: Object3D, to: number, d: number) {
    return axis(this, localScale(this), i as 0, to, d);
  };
});

Object.assign(Object3D.prototype, {
  doMove(this: Object3D, to: Vector3, d: number) {
    return move(this, worldPosition(this), to, d);
  },
  doLocalMove(this: Object3D, to: Vector3, d: number) {
    return move(this, localPosition(this), to, d);
  },
  doScale(this: Object3D, to: number | Vector3, d: number) {
    return move(this, localScale(this), typeof to === 'number' ? new Vector3(to, to, to) : to, d);
  },
  doRotate(this: Object3D, to: Vector3 | Euler, d: number, mode: RotateMode = RotateMode.Fast) {
    return rotate(this, worldRotation(this), to, d, mode);
  },
  doLocalRotate(this: Object3D, to: Vector3 | Euler, d: number, mode: RotateMode = RotateMode.Fast) {
    return rotate(this, localRotation(this), to, d, mode);
  },
  doRotateQuaternion(this: Object3D, to: Quaternion, d: number) {
    const part = worldRotation(this);
    return onNode(this, Tween.to(part.get, part.set, to, d));
  },
  doLocalRotateQuaternion(this: Object3D, to: Quaternion, d: number) {
    const part = localRotation(this);
    return onNode(this, Tween.to(part.get, part.set, to, d));
  },
  doLookAt(this: Object3D, point: Vector3, d: number) {
    const start = this.quaternion.clone();
    this.lookAt(point);
    const end = this.quaternion.clone();
    this.quaternion.copy(start);
    const part = localRotation(this);
    return onNode(this, Tween.to(part.get, part.set, end, d));
  },
  doJump(this: Object3D, to: Vector3, power: number, jumps: number, d: number) {
    return jump(this, worldPosition(this), to, power, jumps, d);
  },
  doLocalJump(this: Object3D, to: Vector3, power: number, jumps: number, d: number) {
    return jump(this, localPosition(this), to, power, jumps, d);
  },
  doPunchPosition(this: Object3D, amount: Vector3, d: number, vibrato = 10, elasticity = 1) {
    return punch(this, added(localPosition(this)), amount, d, vibrato, elasticity);
  },
  doPunchRotation(this: Object3D, amount: Vector3, d: number, vibrato = 10, elasticity = 1) {
    return punch(this, turned(localRotation(this)), amount, d, vibrato, elasticity);
  },
  doPunchScale(this: Object3D, amount: Vector3, d: number, vibrato = 10, elasticity = 1) {
    return punch(this, added(localScale(this)), amount, d, vibrato, elasticity);
  },
  doShakePosition(this: Object3D, d: number, strength: number | Vector3 = 1, vibrato = 10) {
    return shake(this, added(localPosition(this)), strength, d, vibrato);
  },
  doShakeRotation(this: Object3D, d: number, strength: number | Vector3 = 90, vibrato = 10) {
    return shake(this, turned(localRotation(this)), strength, d, vibrato);
  },
  doShakeScale(this: Object3D, d: number, strength: number | Vector3 = 1, vibrato = 10) {
    return shake(this, added(localScale(this)), strength, d, vibrato);
  },
  doKill(this: Object3D, complete = false) {
    Tween.kill(this, complete);
  },
  doComplete(this: Object3D) {
    Tween.kill(this, true);
  },
});

const valueOf = <T extends object, V extends number | Color>(target: T, key: string, to: V, d: number) =>
  Tween.to(
    () => (target as unknown as Record<string, V>)[key]!,
    (v) => {
      const own = target as unknown as Record<string, unknown>;
      if (typeof v === 'number') own[key] = v;
      else (own[key] as Color).copy(v as Color);
    },
    to,
    d,
  ).setTarget(target);

function colorOf(target: object, to: Color, d: number): Tween {
  if (!(target as { color?: unknown }).color) throw new Error(`doColor: a ${target.constructor.name} has no color.`);
  return valueOf(target, 'color', to, d);
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
    return valueOf(this, 'opacity', to, d);
  },
  doFloat(this: Material, to: number, property: string, d: number) {
    return valueOf(this, property, to, d);
  },
});

Object.assign(Light.prototype, {
  doColor(this: Light, to: Color, d: number) {
    return colorOf(this, to, d);
  },
  doIntensity(this: Light, to: number, d: number) {
    return valueOf(this, 'intensity', to, d);
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
