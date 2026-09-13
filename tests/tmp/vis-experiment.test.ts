import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { SceneManager } from '@scenoco-three/core';
import { Canvas, Panel, Text, UIRenderer } from '@scenoco-three/ui';
import { sceneOf } from '../core/helpers.js';

describe('can uikit express hidden-but-live?', () => {
  it('reports what visibility does', async () => {
    const scene = await SceneManager.load(
      sceneOf((s) => {
        const camera = new PerspectiveCamera();
        s.add(camera);
        const canvas = new Canvas();
        camera.add(canvas);
        const panel = new Panel();
        panel.name = 'bar';
        canvas.add(panel);
        const text = new Text();
        text.name = 'label';
        panel.add(text);
      }),
    );
    const ui = scene.getSystem(UIRenderer)!;
    const panel = scene.getObjectByName('bar')! as unknown as {
      setProperties(p: Record<string, unknown>): void;
      properties: { peek(): Record<string, unknown> };
      size?: { value?: unknown };
      visible: boolean;
    };
    ui.layout(1 / 60);
    console.log('  before          display=', panel.properties.peek().display,
                'visibility=', panel.properties.peek().visibility,
                'size=', JSON.stringify(panel.size?.value));

    panel.setProperties({ visibility: 'hidden' });
    ui.layout(1 / 60);
    console.log('  visibility:hidden display=', panel.properties.peek().display,
                'visibility=', panel.properties.peek().visibility,
                'size=', JSON.stringify(panel.size?.value));

    panel.setProperties({ visibility: 'visible' });
    ui.layout(1 / 60);
    console.log('  back            visibility=', panel.properties.peek().visibility,
                'size=', JSON.stringify(panel.size?.value));
    expect(true).toBe(true);
  });
});
