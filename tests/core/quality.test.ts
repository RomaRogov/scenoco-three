import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Mesh, MeshStandardMaterial, PCFSoftShadowMap, BasicShadowMap, Scene } from 'three';
import { QualitySettings, ShadowQuality, type Game } from '@scenoco-three/core';
import { liveGames } from '../../packages/core/src/play.js';

/** What `play` hands QualitySettings, minus the canvas: a renderer's settings and a scene. */
function game(): Game & { material: MeshStandardMaterial } {
  let ratio = 2;
  const renderer = { getPixelRatio: () => ratio, setPixelRatio: (r: number) => (ratio = r), shadowMap: { enabled: true, type: PCFSoftShadowMap } };
  const material = new MeshStandardMaterial();
  const scene = new Scene().add(new Mesh(new BoxGeometry(), material));
  const made = { renderer, scene, material } as unknown as Game & { material: MeshStandardMaterial };
  liveGames.add(made);
  return made;
}

afterEach(() => {
  QualitySettings.setQualityLevel(2);
  liveGames.clear();
});

describe('QualitySettings', () => {
  it("applies a level to every running game, from how it was set up, and gives it back, as Unity's do", () => {
    const g = game();
    const changed = vi.fn();
    QualitySettings.activeQualityLevelChanged.on(changed);
    const version = g.material.version;

    QualitySettings.setQualityLevel(0);
    expect(QualitySettings.names).toEqual(['Low', 'Medium', 'High']);
    expect([QualitySettings.getQualityLevel(), QualitySettings.shadows, QualitySettings.postProcessing]).toEqual([0, ShadowQuality.Disable, false]);
    expect(g.renderer.getPixelRatio()).toBe(1.5); // renderScale 0.75 of the 2 it was set up with
    expect(g.renderer.shadowMap.enabled).toBe(false);
    expect(g.material.version).toBeGreaterThan(version); // compiled again, without shadows
    expect(changed).toHaveBeenCalledWith(2, 0);

    QualitySettings.setQualityLevel(1);
    expect([g.renderer.getPixelRatio(), g.renderer.shadowMap.enabled, g.renderer.shadowMap.type]).toEqual([2, true, BasicShadowMap]);
    QualitySettings.setQualityLevel(2);
    expect(g.renderer.shadowMap.type).toBe(PCFSoftShadowMap); // the game's own again
    QualitySettings.activeQualityLevelChanged.off(changed);
  });

  it('names the levels there are when asked for one that is not', () => {
    expect(() => QualitySettings.setQualityLevel(3)).toThrow('QualitySettings.setQualityLevel: 3 is not a level. There are 3: 0 Low, 1 Medium, 2 High.');
  });
});
