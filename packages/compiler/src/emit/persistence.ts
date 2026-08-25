import type { SncElement } from '../dsl/parse.js';
import type { EmitScope } from './scope.js';
import { PERSIST } from './placement.js';

/**
 * `dontDestroyOnLoad="true"` on a node — Unity's, with Unity's meaning.
 *
 * The node is moved into the persistent scene, so it survives every later `SceneManager.load`
 * and is drawn over whatever is active. It keeps its components and its children.
 *
 * The caveat is Unity's caveat, and it is worth knowing before reaching for this: **two
 * scenes that each declare a persistent node produce two of it.** A scene marked
 * `dontDestroyOnLoad` is the safer shape for anything a whole game shares — a HUD, an audio
 * rig — because `loadAdditive` of an already-loaded scene does nothing, so every level may
 * ask for it and exactly one exists.
 */
export function applyPersistence(scope: EmitScope, element: SncElement, target: string, out: string[]): void {
  const text = element.attributes.get(PERSIST);
  if (text === undefined) return;
  if (scope.options.kind === 'prefab') {
    scope.report(
      element,
      'persist-in-prefab',
      `A prefab does not decide its own lifetime — it may be spawned into any scene, and ` +
        `moving itself out of one mid-build would leave it in neither. Write ${PERSIST} on ` +
        'the <Prefab> element that spawns it.',
    );
    return;
  }
  const value = text.trim();
  if (value !== 'true' && value !== 'false') {
    scope.report(element, 'bad-boolean', `${PERSIST}="${text}" must be "true" or "false".`);
    return;
  }
  if (value === 'false') return;
  const manager = scope.module.require('@scenoco-three/core', 'SceneManager');
  out.push(`${manager}.${PERSIST}(${target});`);
}
