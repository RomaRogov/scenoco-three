import { Euler, MathUtils } from 'three';
import { describe, expect, it } from 'vitest';
import { Engine } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';
import { SceneDocument } from '../../packages/editor/app/document.js';
import { EulerProbe } from '../fixtures/components/EulerProbe.js';

/**
 * The euler unit contract, in one place. Compiled values are **degrees** end to
 * end (XML, bundle, `transform.eulerAngles`, component props); a live THREE
 * `Euler` is **radians**. Core's `instantiate` is the reference — `eulerAngles`
 * writes through the degrees accessor, and component props go through
 * `eulerFromDegrees`. The editor mutates the same compiled model, so it has to
 * convert at exactly the same boundary or an authored rotation is off by 57×.
 */
function realDoc(xml: string): { doc: SceneDocument; engine: Engine } {
  const r = compileSceneXml(xml);
  if (!r.ok) throw new Error(`fixture failed to compile: ${JSON.stringify(r.diagnostics)}`);
  const engine = new Engine({ editor: true });
  engine.loadScene(bundleScene(r.scene));
  return { doc: new SceneDocument(engine.getSceneGraph()!, r.provenance, engine), engine };
}

describe('euler units — compiled degrees vs runtime radians', () => {
  it('setTransform("eulerAngles") takes degrees and drives rotation in radians', () => {
    const { doc, engine } = realDoc('<Scene><Group id="g" /></Scene>');
    const g = engine.findObject('g')!;

    doc.setTransform(g, 'eulerAngles', [90, 0, 0]);

    expect(g.rotation.x).toBeCloseTo(Math.PI / 2, 6); // radians on the Object3D
    expect(g.eulerAngles.x).toBeCloseTo(90, 6); // degrees through the accessor
  });

  it('setComponentProp on a Euler property takes degrees and stores a radians Euler', () => {
    const { doc, engine } = realDoc('<Scene><Group id="g"><Components><EulerProbe id="p" /></Components></Group></Scene>');
    const probe = engine.findObject('g')!.getComponent(EulerProbe)!;

    doc.setComponentProp(probe, 'tilt', [0, 180, 0]);

    expect(probe.tilt).toBeInstanceOf(Euler);
    expect(probe.tilt.y).toBeCloseTo(Math.PI, 6); // 180° → π radians
    expect(MathUtils.radToDeg(probe.tilt.y)).toBeCloseTo(180, 6);
  });
});
