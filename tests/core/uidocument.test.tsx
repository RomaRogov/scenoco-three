import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Scene } from 'three';
import { Screen, UIDocument, simulate } from '@scenoco-three/core';

afterEach(() => vi.unstubAllGlobals());

describe('UIDocument', () => {
  it("lays the page's UI out at its reference resolution and scales it to the screen, as Unity's Scale With Screen Size does", () => {
    const root = { style: {} as Record<string, string> };
    vi.stubGlobal('document', { getElementById: (id: string) => (id === 'hud' ? root : null) });
    const game = simulate(() => (
      <Scene>
        <PerspectiveCamera />
        <UIDocument element="hud" referenceResolution={[1280, 720]} match={0.5} />
      </Scene>
    ));
    game.step();
    // With no window, Screen is 1920×1080: half again the reference, both ways.
    expect([Screen.width, Screen.height]).toEqual([1920, 1080]);
    expect(root.style).toMatchObject({ width: '1280px', height: '720px', scale: '1.5', transformOrigin: '0 0', pointerEvents: 'none' });
    game.dispose();
  });
});
