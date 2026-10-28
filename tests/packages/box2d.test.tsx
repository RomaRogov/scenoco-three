import { afterEach, describe, expect, it } from 'vitest';
import { Group, Object3D, Scene, Vector2 } from 'three';
import { Behaviour, Runtime, destroy, wake } from '@scenoco-three/core';
import {
  BoxCollider2D,
  CircleCollider2D,
  Collision2D,
  DistanceJoint2D,
  FixedJoint2D,
  FrictionJoint2D,
  HingeJoint2D,
  RelativeJoint2D,
  SliderJoint2D,
  SpringJoint2D,
  TargetJoint2D,
  WheelJoint2D,
  type Joint2D,
  ForceMode2D,
  Physics2D,
  PolygonCollider2D,
  Rigidbody2D,
  RigidbodyConstraints2D,
  RigidbodyType2D,
  type Collider2D,
} from '@scenoco-three/box2d';

const runtimes: Runtime[] = [];
afterEach(() => {
  runtimes.splice(0).forEach((r) => r.dispose());
  Physics2D.gravity.set(0, -9.81);
  Physics2D.ignoreLayerCollision(1, 2, false);
});

function run(scene: Scene, seconds: number): Runtime {
  const runtime = runtimes.find((r) => r.root === scene) ?? new Runtime(scene);
  if (!runtimes.includes(runtime)) runtimes.push(runtime);
  wake(scene);
  for (let i = 0; i < Math.round(seconds * 60); i++) runtime.update(1 / 60);
  return runtime;
}

/** Writes down every contact message it receives. */
class Ears extends Behaviour {
  heard: string[] = [];
  last: Collision2D | null = null;
  override onCollisionEnter2D(c: Collision2D) { this.heard.push(`enter ${c.node.name}`); this.last = c; }
  override onCollisionStay2D(c: Collision2D) { if (this.heard.at(-1) !== `stay ${c.node.name}`) this.heard.push(`stay ${c.node.name}`); this.last = c; }
  override onCollisionExit2D(c: Collision2D) { this.heard.push(`exit ${c.node.name}`); }
  override onTriggerEnter2D(other: Collider2D) { this.heard.push(`trigger ${other.node.name}`); }
}

describe('box2d', () => {
  it("lands on a collider with no body, as Unity's static colliders, and hears Enter, Stay and Exit with the contact", () => {
    const scene = (
      <Scene>
        <Group name="ball" position={[0, 3, 0]}>
          <Rigidbody2D />
          <CircleCollider2D radius={0.5} />
          <Ears />
        </Group>
        <Group name="zone" position={[0, 1.8, 0]}>
          <BoxCollider2D size={[4, 0.2]} isTrigger />
        </Group>
        <Group name="ground">
          <BoxCollider2D size={[10, 1]} />
        </Group>
      </Scene>
    ) as Scene;
    run(scene, 2);
    const ball = scene.getObjectByName('ball')!;
    const ears = ball.getComponent(Ears)!;
    expect(ball.position.y).toBeCloseTo(1, 1); // the ground's top is at 0.5
    expect(ears.heard).toEqual(['trigger zone', 'enter ground', 'stay ground']);
    const contact = ears.last!.getContact(0);
    expect(contact.normal.y).toBeCloseTo(1, 3); // out of the ground, towards the ball
    expect(contact.point.y).toBeCloseTo(0.5, 1);
    destroy(scene.getObjectByName('ground')!);
    run(scene, 0.1);
    expect(ears.heard.at(-1)).toBe('exit ground');
  });

  it("weighs 1 kg whatever its size unless useAutoMass, and keeps to its constraints", () => {
    Physics2D.gravity.set(0, 0);
    const scene = (
      <Scene>
        <Group name="big"><Rigidbody2D /><BoxCollider2D size={[4, 4]} /></Group>
        <Group name="auto" position={[10, 0, 0]}><Rigidbody2D useAutoMass /><BoxCollider2D size={[2, 2]} density={3} /></Group>
        <Group name="rail" position={[20, 0, 0]}><Rigidbody2D constraints={RigidbodyConstraints2D.FreezePositionY | RigidbodyConstraints2D.FreezeRotation} /><BoxCollider2D /></Group>
      </Scene>
    ) as Scene;
    run(scene, 0.05);
    const big = scene.getObjectByName('big')!.getComponent(Rigidbody2D)!;
    expect(big.mass).toBe(1);
    expect(scene.getObjectByName('auto')!.getComponent(Rigidbody2D)!.mass).toBeCloseTo(12, 3);
    big.addForce(new Vector2(2, 0), ForceMode2D.Impulse);
    expect(big.linearVelocity.x).toBeCloseTo(2, 3); // 2 N·s on 1 kg
    const rail = scene.getObjectByName('rail')!.getComponent(Rigidbody2D)!;
    rail.addForceAtPosition(new Vector2(3, 3), new Vector2(20, 0.5), ForceMode2D.Impulse);
    run(scene, 0.5);
    expect(rail.position.x).toBeGreaterThan(20.5);
    expect(rail.position.y).toBeCloseTo(0, 5);
    expect(rail.rotation).toBeCloseTo(0, 5);
  });

  it('joins colliders on child nodes into one body, following their scale, and pushes with a kinematic body', () => {
    const scene = (
      <Scene>
        <Group name="cart" position={[0, 3, 0]}>
          <Rigidbody2D />
          <Group name="wheel" position={[-1, -0.5, 0]}><CircleCollider2D radius={0.5} /></Group>
          <Group position={[1, -0.5, 0]}><CircleCollider2D radius={0.5} /></Group>
        </Group>
        <Group name="ground"><BoxCollider2D size={[30, 1]} /></Group>
        <Group name="pusher" position={[-6, 1.5, 0]}>
          <Rigidbody2D bodyType={RigidbodyType2D.Kinematic} />
          <BoxCollider2D size={[1, 2]} />
        </Group>
      </Scene>
    ) as Scene;
    run(scene, 2);
    const cart = scene.getObjectByName('cart')!;
    expect(cart.position.y).toBeCloseTo(1.5, 1); // resting on its wheels
    const wheel = scene.getObjectByName('wheel')!;
    wheel.scale.setScalar(2);
    run(scene, 1);
    expect(wheel.getComponent(CircleCollider2D)!.planckFixtures[0]!.getShape().getRadius()).toBeCloseTo(1, 5);
    expect(cart.position.y).toBeGreaterThan(1.6); // propped up on the side whose wheel grew
    const pusher = scene.getObjectByName('pusher')!;
    const pushed = (x: number) => {
      pusher.position.x = x;
      run(scene, 1 / 60);
    };
    for (let x = -6; x <= 0; x += 0.05) pushed(x);
    expect(cart.position.x).toBeGreaterThan(1.5); // pushed along, not passed through
  });

  it("answers Unity's queries by layer and trigger, and ignores layer pairs", () => {
    Physics2D.gravity.set(0, 0);
    const scene = (
      <Scene>
        <Group name="near" position={[3, 0, 0]}><BoxCollider2D /></Group>
        <Group name="far" position={[6, 0, 0]}><BoxCollider2D layer={2} /></Group>
        <Group name="zone" position={[9, 0, 0]}><BoxCollider2D isTrigger /></Group>
        <Group name="mover" position={[0, 5, 0]}><Rigidbody2D gravityScale={0} /><CircleCollider2D layer={1} /></Group>
        <Group name="wall" position={[0, 8, 0]}><BoxCollider2D size={[4, 1]} layer={2} /></Group>
      </Scene>
    ) as Scene;
    run(scene, 1 / 60);
    const hit = Physics2D.raycast(new Vector2(0, 0), new Vector2(1, 0))!;
    expect(hit.node.name).toBe('near');
    expect(hit.distance).toBeCloseTo(2.5, 3);
    expect(hit.normal.x).toBeCloseTo(-1, 3);
    expect(Physics2D.raycast(new Vector2(0, 0), new Vector2(1, 0), 2)).toBeNull();
    expect(Physics2D.raycast(new Vector2(0, 0), new Vector2(1, 0), Infinity, 1 << 2)!.node.name).toBe('far');
    expect(Physics2D.raycastAll(new Vector2(0, 0), new Vector2(1, 0)).map((h) => h.node.name)).toEqual(['near', 'far', 'zone']);
    // A ray from inside a collider hits it at once, as Unity's does by default.
    expect(Physics2D.raycast(new Vector2(3, 0), new Vector2(1, 0))!.distance).toBe(0);
    expect(Physics2D.overlapPoint(new Vector2(6.2, 0.2))?.node.name).toBe('far');
    expect(Physics2D.overlapCircleAll(new Vector2(4.5, 0), 1.2).map((c) => c.node.name).sort()).toEqual(['far', 'near']);
    expect(Physics2D.overlapBox(new Vector2(9, 0), new Vector2(0.2, 0.2), 45)?.node.name).toBe('zone');
    Physics2D.queriesHitTriggers = false;
    expect(Physics2D.overlapBox(new Vector2(9, 0), new Vector2(0.2, 0.2))).toBeNull();
    Physics2D.queriesHitTriggers = true;

    // Layers 1 and 2 ignore each other: the mover goes up through the wall.
    Physics2D.ignoreLayerCollision(1, 2);
    const mover = scene.getObjectByName('mover')!;
    mover.getComponent(Rigidbody2D)!.linearVelocity = new Vector2(0, 5);
    run(scene, 1.5);
    expect(mover.position.y).toBeGreaterThan(10);
  });

  it('keeps a ball inside a concave polygon, cut into convex pieces', () => {
    const scene = (
      <Scene>
        <Group name="cup">
          <PolygonCollider2D points={[[-2, 0], [2, 0], [2, 3], [1.5, 3], [1.5, 0.5], [-1.5, 0.5], [-1.5, 3], [-2, 3]].map(([x, y]) => new Vector2(x, y))} />
        </Group>
        <Group name="ball" position={[0.5, 4, 0]}><Rigidbody2D /><CircleCollider2D radius={0.4} bounciness={0.3} /></Group>
      </Scene>
    ) as Scene;
    run(scene, 3);
    const ball = scene.getObjectByName('ball')!;
    expect(ball.position.y).toBeCloseTo(0.9, 1); // on the cup's floor at 0.5
    expect(Math.abs(ball.position.x)).toBeLessThan(1.5);
    expect(scene.getObjectByName('cup')!.getComponent(PolygonCollider2D)!.planckFixtures.length).toBeGreaterThan(1);
  });
});

class Snapped extends Behaviour {
  broke: Joint2D | null = null;
  override onJointBreak2D(joint: Joint2D) { this.broke = joint; }
}

describe('box2d joints', () => {
  it("hinges about the anchor, the motor turning as Unity's does, within the limits", () => {
    const scene = (
      <Scene>
        <Group name="pendulum" position={[2, 0, 0]}><Rigidbody2D /><CircleCollider2D radius={0.2} /><HingeJoint2D anchor={[-2, 0]} /></Group>
        <Group name="flipper" position={[0, 10, 0]}><Rigidbody2D gravityScale={0} /><BoxCollider2D size={[2, 0.2]} /><HingeJoint2D useMotor motor={{ motorSpeed: 90, maxMotorTorque: 1000 }} /></Group>
        <Group name="gate" position={[11, 10, 0]}><Rigidbody2D /><BoxCollider2D size={[2, 0.2]} /><HingeJoint2D anchor={[-1, 0]} useLimits limits={{ min: -20, max: 20 }} /></Group>
      </Scene>
    ) as Scene;
    run(scene, 1);
    const pendulum = scene.getObjectByName('pendulum')!;
    expect(pendulum.position.length()).toBeCloseTo(2, 2);
    expect(pendulum.position.y).toBeLessThan(-1);
    expect(pendulum.getComponent(HingeJoint2D)!.connectedAnchor.toArray()).toEqual([0, 0]); // the world point it hangs from
    // The angle is the connected side's turn against this body: a positive speed turns this one clockwise.
    const flipper = scene.getObjectByName('flipper')!;
    expect(flipper.getComponent(Rigidbody2D)!.rotation).toBeCloseTo(-90, -1);
    expect(flipper.getComponent(HingeJoint2D)!.jointAngle).toBeCloseTo(90, -1);
    expect(Math.abs(scene.getObjectByName('gate')!.getComponent(Rigidbody2D)!.rotation)).toBeLessThan(21);
  });

  it('holds a distance as a rod, at most as a rope, and springs back to it', () => {
    Physics2D.gravity.set(0, 0);
    const scene = (
      <Scene>
        <Group name="rod" position={[0, -1, 0]}><Rigidbody2D /><CircleCollider2D radius={0.1} /><DistanceJoint2D /></Group>
        <Group name="rope" position={[10, -1, 0]}><Rigidbody2D /><CircleCollider2D radius={0.1} /><DistanceJoint2D connectedAnchor={[10, 0]} maxDistanceOnly /></Group>
        <Group name="spring" position={[20, -1, 0]}><Rigidbody2D /><CircleCollider2D radius={0.1} /><SpringJoint2D connectedAnchor={[20, 0]} frequency={2} dampingRatio={1} /></Group>
      </Scene>
    ) as Scene;
    run(scene, 0);
    for (const name of ['rod', 'rope', 'spring']) scene.getObjectByName(name)!.getComponent(Rigidbody2D)!.addForce(new Vector2(0, 3), ForceMode2D.Impulse);
    run(scene, 0.3);
    expect(scene.getObjectByName('rod')!.position.length()).toBeCloseTo(1, 2);
    expect(scene.getObjectByName('rope')!.position.y).toBeGreaterThan(-0.5); // slack: it went up
    expect(scene.getObjectByName('rope')!.getComponent(DistanceJoint2D)!.distance).toBeCloseTo(1, 5);
    scene.getObjectByName('rod')!.getComponent(Rigidbody2D)!.addForce(new Vector2(0, -50), ForceMode2D.Impulse);
    scene.getObjectByName('rope')!.getComponent(Rigidbody2D)!.addForce(new Vector2(0, -50), ForceMode2D.Impulse);
    run(scene, 3);
    expect(scene.getObjectByName('rope')!.position.y).toBeGreaterThan(-1.01);
    expect(scene.getObjectByName('spring')!.position.y).toBeCloseTo(-1, 1); // back where it rests
  });

  it('glues two bodies, and breaks past breakForce: onJointBreak2D, then the joint is gone', () => {
    const anchor = { current: null as Rigidbody2D | null };
    const scene = (
      <Scene>
        <Group name="crate" position={[0, 5, 0]}><Rigidbody2D gravityScale={0} ref={anchor} /><BoxCollider2D /></Group>
        <Group name="lid" position={[0, 6, 0]} rotation={[0, 0, 0.3]}><Rigidbody2D /><BoxCollider2D /><FixedJoint2D connectedBody={anchor} /></Group>
        <Group name="sign" position={[5, 5, 0]}><Rigidbody2D mass={10} /><BoxCollider2D /><FixedJoint2D breakForce={50} /><Snapped /></Group>
      </Scene>
    ) as Scene;
    run(scene, 1);
    const crate = scene.getObjectByName('crate')!;
    const lid = scene.getObjectByName('lid')!;
    expect(lid.position.y - crate.position.y).toBeCloseTo(1, 2);
    expect(lid.rotation.z - crate.rotation.z).toBeCloseTo(0.3, 2);
    const sign = scene.getObjectByName('sign')!;
    expect(sign.getComponent(Snapped)!.broke).toBeInstanceOf(FixedJoint2D);
    expect(sign.getComponent(FixedJoint2D)).toBeNull();
    expect(sign.position.y).toBeLessThan(2);
  });

  it('slides, rolls on a wheel, follows a target, holds an offset and drags by friction', () => {
    const wheel = { current: null as Rigidbody2D | null };
    const leader = { current: null as Rigidbody2D | null };
    const scene = (
      <Scene>
        <Group name="ground" position={[0, -0.5, 0]}><BoxCollider2D size={[200, 1]} /></Group>
        <Group name="lift" position={[0, 20, 0]}><Rigidbody2D /><BoxCollider2D /><SliderJoint2D angle={90} useLimits limits={{ min: -3, max: 3 }} useMotor motor={{ motorSpeed: -2, maxMotorTorque: 1000 }} /></Group>
        <Group name="car" position={[30, 1.5, 0]}><Rigidbody2D /><BoxCollider2D size={[3, 0.5]} /><WheelJoint2D anchor={[-1, -0.9]} connectedBody={wheel} useMotor motor={{ motorSpeed: 360, maxMotorTorque: 500 }} /></Group>
        <Group name="wheel" position={[29, 0.6, 0]}><Rigidbody2D ref={wheel} /><CircleCollider2D radius={0.6} /></Group>
        <Group name="dragged" position={[60, 10, 0]}><Rigidbody2D /><BoxCollider2D /><TargetJoint2D /></Group>
        <Group name="leader" position={[80, 10, 0]}><Rigidbody2D bodyType={RigidbodyType2D.Kinematic} ref={leader} /></Group>
        <Group name="follower" position={[82, 10, 0]}><Rigidbody2D gravityScale={0} /><BoxCollider2D /><RelativeJoint2D connectedBody={leader} /></Group>
        <Group name="puck" position={[100, 10, 0]}><Rigidbody2D gravityScale={0} /><CircleCollider2D /><FrictionJoint2D maxForce={2} /></Group>
      </Scene>
    ) as Scene;
    run(scene, 0);
    scene.getObjectByName('puck')!.getComponent(Rigidbody2D)!.linearVelocity = new Vector2(3, 0);
    scene.getObjectByName('dragged')!.getComponent(TargetJoint2D)!.target.set(64, 12);
    scene.getObjectByName('leader')!.position.x += 1;
    run(scene, 3);
    const lift = scene.getObjectByName('lift')!;
    expect(lift.position.x).toBeCloseTo(0, 3);
    expect(lift.position.y).toBeCloseTo(23, 1); // driven up to its upper limit, against gravity
    expect(lift.getComponent(SliderJoint2D)!.jointTranslation).toBeCloseTo(-3, 1); // measured from the connected side, as the angle is
    expect(scene.getObjectByName('car')!.position.x).toBeLessThan(25); // a positive speed turns the wheel counter-clockwise: it rolls left
    const dragged = scene.getObjectByName('dragged')!;
    expect(dragged.position.x).toBeCloseTo(64, 1);
    expect(dragged.position.y).toBeCloseTo(12, 0);
    expect(scene.getObjectByName('follower')!.position.x).toBeCloseTo(83, 1);
    const puck = scene.getObjectByName('puck')!.getComponent(Rigidbody2D)!;
    expect(puck.linearVelocity.length()).toBeLessThan(0.01);
    expect(puck.position.x).toBeGreaterThan(101);
  });

  it('makes the joint again when its placement changes or it is enabled, and lets go of a destroyed body', () => {
    Physics2D.gravity.set(0, 0);
    const other = { current: null as Rigidbody2D | null };
    const scene = (
      <Scene>
        <Group name="other" position={[2, 0, 0]}><Rigidbody2D ref={other} /><CircleCollider2D radius={0.2} /></Group>
        <Group name="self"><Rigidbody2D /><CircleCollider2D radius={0.2} /><DistanceJoint2D connectedBody={other} /></Group>
      </Scene>
    ) as Scene;
    run(scene, 0.1);
    const joint = scene.getObjectByName('self')!.getComponent(DistanceJoint2D)!;
    const first = joint.planckJoint;
    expect(joint.distance).toBeCloseTo(2, 5);
    joint.maxDistanceOnly = true;
    run(scene, 0.1);
    expect(joint.planckJoint).not.toBe(first);
    expect(joint.planckJoint!.getType()).toBe('rope-joint');
    joint.enabled = false;
    expect(joint.planckJoint).toBeNull();
    joint.enabled = true;
    expect(joint.planckJoint).not.toBeNull();
    destroy(scene.getObjectByName('other')!);
    run(scene, 0.1);
    expect(joint.planckJoint).toBeNull();
    expect(Physics2D.world!.getJointCount()).toBe(0);
  });
});

void Object3D;
