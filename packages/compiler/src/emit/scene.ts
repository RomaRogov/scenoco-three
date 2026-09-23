import { hint, nearestName } from '../dsl/diagnostics.js';
import type { SncElement } from '../dsl/parse.js';
import { emitValue } from '../dsl/value.js';
import type { EmitScope, Placed } from './scope.js';
import { PERSIST, SCENE_ATTRIBUTES, STRUCTURAL } from './placement.js';

/** True when a placed node is a camera — `Camera` is in the tag's base chain. */
export function isCamera(placed: Placed): boolean {
  return placed.tag?.bases.includes('Camera') === true;
}

export function applySceneSettings(scope: EmitScope, root: SncElement, out: string[]): void {
  const tag = scope.options.model.tags.find((t) => t.name === 'Scene');
  for (const [attribute, text] of root.attributes) {
    if (attribute === 'id' || attribute.includes(':')) continue;
    // `camera` is emitted by `emitMainCamera`, which also checks that it points at a camera.
    if (attribute === 'camera') continue;
    if (STRUCTURAL.has(attribute) && attribute !== PERSIST) continue;

    // three.js puts fog on the scene; SceNoCo puts everything about how a scene is *drawn* in
    // one document, so that a scene can be shown two ways without editing the scene. It is a
    // property of `Scene`, so without this it went to the value emitter and came back as a path
    // that resolves to nothing — true, and about the wrong thing entirely.
    if (attribute === 'fog') {
      scope.report(
        root,
        'misplaced-fog',
        'Fog lives in a render document, with the tone curve and the post effects it works ' +
          'alongside: <Render><Fog color="#889" near="10" far="80" /></Render> in a `.render.xml`, ' +
          'named here as <Scene render="../render/day.render.xml">.',
      );
      continue;
    }

    const engine = SCENE_ATTRIBUTES[attribute];
    const prop = engine ?? tag?.properties.find((p) => p.name === attribute);
    if (!prop) {
      const names = [...(tag?.properties ?? []).map((p) => p.name), ...Object.keys(SCENE_ATTRIBUTES)];
      const advice = hint({ near: nearestName(attribute, names), as: 'attribute', ask: 'Scene' });
      scope.report(
        root,
        'unknown-attribute',
        `<Scene> has no attribute "${attribute}".${advice.text}`,
        advice.ask,
      );
      continue;
    }
    const emitted = emitValue(prop, text, root, scope.context);
    scope.module.reportAll(emitted.diagnostics);
    if (emitted.code) out.push(`this.${attribute} = ${emitted.code};`);
  }
}


/**
 * Say which camera the scene renders with.
 *
 * `Engine` draws `scene.mainCamera` and nothing else, so a scene that never sets it renders a
 * blank screen with no error anywhere — which is exactly what every generated scene did until
 * this existed. A document says it with `<Scene camera="#id">`.
 *
 * A scene that declares exactly one camera does not have to say anything: there is only one
 * answer, and making everyone write it would be ceremony for the common case. Declare two and
 * the choice is real, so the document has to make it.
 */
export function emitMainCamera(scope: EmitScope, root: SncElement, out: string[]): void {
  const href = root.attributes.get('camera');
  if (href !== undefined) {
    const id = href.trim().replace(/^#/, '');
    const target = scope.byId.get(id);
    if (!target) {
      scope.report(root, 'unknown-id', `camera="${href}" points at id "${id}", which no node in this document declares.`);
      return;
    }
    if (!isCamera(target)) {
      scope.report(root, 'not-a-camera', `camera="${href}" points at <${target.element.tag}>, which is not a camera.`);
      return;
    }
    out.push(`this.mainCamera = ${target.reference};`);
    return;
  }

  const cameras = [...scope.byElement.values()].filter(isCamera);
  if (cameras.length === 1) {
    out.push(`this.mainCamera = ${cameras[0]!.reference};`);
    return;
  }
  if (cameras.length > 1) {
    const named = cameras.map((c) => c.element.attributes.get('id')).filter(Boolean);
    scope.report(
      root,
      'ambiguous-camera',
      `This scene declares ${cameras.length} cameras, so it has to say which one it renders ` +
        `with: <Scene camera="#${named[0] ?? 'id'}">.`,
    );
  }
}


