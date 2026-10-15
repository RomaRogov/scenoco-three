import { afterEach, describe, expect, it } from 'vitest';
import { Group, Mesh, Scene, type Object3D } from 'three';
import { Behaviour, Runtime, wake } from '@scenoco-three/core';
import { BoxCollider2D, CircleCollider2D, Physics2D, Rigidbody2D } from '@scenoco-three/box2d';

const runtimes: Runtime[] = [];
afterEach(() => {
  runtimes.splice(0).forEach((r) => r.dispose());
  Physics2D.gravity.set(0, -9.81);
});

class Ears extends Behaviour {
  heard: string[] = [];
  override onCollisionEnter2D(other: Object3D) {
    this.heard.push(`hit ${other.name}`);
  }
  override onTriggerEnter2D(other: Object3D) {
    this.heard.push(`entered ${other.name}`);
  }
}

describe('box2d', () => {
  it('drops a body under Physics2D.gravity and tells both sides of a contact and a trigger', () => {
    Physics2D.gravity.set(0, -20);
    const scene = (
      <Scene>
        <Mesh name="ball" position={[0, 3, 0]}>
          <Rigidbody2D />
          <CircleCollider2D radius={0.5} />
          <Ears />
        </Mesh>
        <Group name="sensor" position={[0, 1.5, 0]}>
          <Rigidbody2D bodyType="static" />
          <BoxCollider2D halfExtents={[2, 0.1]} isSensor />
        </Group>
        <Group name="ground">
          <Rigidbody2D bodyType="static" />
          <BoxCollider2D halfExtents={[5, 0.5]} />
          <Ears />
        </Group>
      </Scene>
    ) as Scene;
    const runtime = new Runtime(scene);
    runtimes.push(runtime);
    wake(scene);
    for (let i = 0; i < 90; i++) runtime.update(1 / 60);

    const ball = scene.getObjectByName('ball')!;
    expect(ball.position.y).toBeLessThan(1.1); // fell, and rests on the ground's top at 0.5 + 0.5
    expect(ball.position.y).toBeGreaterThan(0.9);
    expect(ball.getComponent(Ears)!.heard).toEqual(['entered sensor', 'hit ground']);
    expect(scene.getObjectByName('ground')!.getComponent(Ears)!.heard).toEqual(['hit ball']);
  });
});
