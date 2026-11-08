// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { PerspectiveCamera, Scene } from 'three';
import { Behaviour, Input, UIDocument, simulate, type Simulation } from '@scenoco-three/core';

let game: Simulation | null = null;
afterEach(() => game?.dispose());

const page = `<!doctype html><html><head><style>#ui .hidden { display: none }</style></head><body>
  <div id="ui"><span id="score">0</span><button data-button="Play">Play</button><p id="over" class="hidden">Game over</p></div>
  <script type="module" src="/src/main.ts"></script>
</body></html>`;

class Score extends Behaviour {
  points = 0;
  override update() {
    if (Input.getButtonDown('Play')) this.points++;
    this.getComponent(UIDocument)!.rootVisualElement.querySelector('#score')!.textContent = String(this.points);
  }
}

describe('simulate with the page', () => {
  it("puts the page's body and styles in the document, so the HUD a behaviour writes, as styled, and the buttons it reads are there", () => {
    game = simulate(
      () => (
        <Scene>
          <PerspectiveCamera />
          <UIDocument />
          <Score />
        </Scene>
      ),
      { page },
    );
    expect(document.querySelector('script')).toBeNull();
    expect(getComputedStyle(document.getElementById('over')!).display).toBe('none');
    game.click('Play');
    expect(document.getElementById('score')!.textContent).toBe('1');
    expect(() => game!.click('Pause')).toThrow('click: the page has no data-button called "Pause". It has: Play.');
    game.dispose();
    game = null;
    expect(document.getElementById('ui')).toBeNull(); // the document as it was
    expect(document.head.querySelector('style')).toBeNull();
  });
});
