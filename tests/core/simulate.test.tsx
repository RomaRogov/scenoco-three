import { describe, expect, it } from 'vitest';
import { Mesh, PerspectiveCamera, Scene } from 'three';
import { Behaviour, Input, KeyCode, findObjectOfType, simulate } from '@scenoco-three/core';

class GameState extends Behaviour {
  phase: 'ready' | 'playing' = 'ready';
  ended = false;
  override update() {
    if (this.phase === 'ready' && Input.getKeyDown(KeyCode.Space)) this.phase = 'playing';
  }
  override onDestroy() {
    this.ended = true;
  }
}

class Walker extends Behaviour<Mesh> {
  override update(dt: number) {
    this.node.position.x += Input.getAxisRaw('Horizontal') * 2 * dt;
  }
}

const Main = () => (
  <Scene>
    <PerspectiveCamera />
    <GameState />
    <Mesh name="hero">
      <Walker />
    </Mesh>
  </Scene>
);

describe('simulate', () => {
  it("runs a scene with no canvas: a test steps it, presses keys and reads the game's rules", () => {
    const game = simulate(Main);
    const state = findObjectOfType(GameState)!;
    expect(game.until(() => state.phase === 'playing', 30)).toBe(false); // nothing pressed, nothing starts
    game.press(KeyCode.Space);
    expect(state.phase).toBe('playing');

    game.keyDown(KeyCode.RightArrow);
    game.step(60);
    game.keyUp(KeyCode.RightArrow);
    expect(game.scene.getObjectByName('hero')!.position.x).toBeCloseTo(2, 5); // 2 units a second, one second
    expect(game.camera).toBeInstanceOf(PerspectiveCamera);

    game.dispose();
    expect(state.ended).toBe(true);
  });

  it('names a second copy of three.js, where instanceof fails silently', () => {
    // What another copy's Scene looks like from here: an Object3D by its flag, not by its class.
    const Other = () => ({ isObject3D: true, type: 'Scene' }) as never;
    expect(() => simulate(Other)).toThrow(/another copy of three\.js.*npm ls three.*dedupe: \['three'\]/);
  });
});
