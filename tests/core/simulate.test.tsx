import { describe, expect, it, vi } from 'vitest';
import { Mesh, PerspectiveCamera, Scene } from 'three';
import { Vector3 } from 'three';
import { Behaviour, Input, KeyCode, Screen, findObjectOfType, simulate } from '@scenoco-three/core';

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
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(game.until(() => state.phase === 'playing', 30)).toBe(false); // nothing pressed, nothing starts
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^simulate: until\(\(\) => state\.phase === .playing.\) was still false after 30 frames\. Pass more: until\(condition, 120\)\.$/));
    warn.mockRestore();
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

  it('takes a pointer as the page does: pixels of its size, a press, a drag, a release, and a button by name', () => {
    const seen: string[] = [];
    class Drag extends Behaviour {
      override update() {
        if (Input.getMouseButtonDown()) seen.push(`down ${Input.mousePosition.x},${Input.mousePosition.y}`);
        if (Input.getMouseButtonUp()) seen.push(`up ${Input.mousePosition.x}`);
        if (Input.getButtonDown('NextLevel')) seen.push('next');
      }
    }
    const game = simulate(
      () => (
        <Scene>
          <PerspectiveCamera position={[0, 0, 10]} />
          <Drag />
        </Scene>
      ),
      { size: [400, 800] },
    );
    game.step();
    expect(Screen.width).toBe(400);
    expect((game.camera as PerspectiveCamera).aspect).toBe(0.5);
    const [x, y] = game.worldToScreen(new Vector3(0, 0, 0));
    expect([x, y]).toEqual([200, 400]);
    game.pointerDown(x, y);
    game.step();
    expect(Input.pointer.toArray()).toEqual([0, 0]);
    game.pointerUp();
    game.step();
    game.swipe([200, 400], [300, 400], 4);
    game.click('NextLevel');
    expect(seen).toEqual(['down 200,400', 'up 200', 'down 225,400', 'up 300', 'next']);
    game.dispose();
    expect(Screen.width).toBe(1920);
  });
});
