import type { ProjectModel } from '../model.js';
import { scanComponents, scanEffects, scanSystems } from './components.js';
import { scanTags } from './tags.js';
import { Workspace } from './workspace.js';

/**
 * Where a project's component, system and effect classes are read from: the tag packages it
 * depends on, plus core.
 *
 * Core is in the list and not in the *tag* list, and the difference matters. It exports no node
 * tags, so asking `scanTags` for it would be a lookup for nothing — and worse, an error in a
 * project whose TypeScript never imports it. But it does export one component (`CameraFit`), so
 * the class scan has to reach it, and that scan simply finds nothing if the module is absent.
 */
export function classSources(modules: readonly string[]): string[] {
  const packages = modules.filter((m) => m !== 'three');
  return packages.includes(CORE) ? packages : [CORE, ...packages];
}

/** The package that declares `Component`, `System` and `Effect` — and one component of its own. */
const CORE = '@scenoco-three/core';

/**
 * Everything the emitters need about one project, from one open TypeScript program.
 *
 * The two scans share a workspace on purpose: opening a project is the expensive part, and a
 * build that opened one for components and another for tags would load and bind `three`'s
 * declarations twice.
 */
export function scanProject(
  tsconfigPath: string,
  options: { cwd?: string; modules?: readonly string[] } = {},
): ProjectModel {
  const modules = options.modules ?? ['three'];
  const packages = classSources(modules);
  return Workspace.with(
    tsconfigPath,
    (workspace) => ({
      // The same module list everywhere: a package contributes node tags, components and
      // systems through one dependency, and a project that does not depend on it sees none.
      components: scanComponents(workspace, packages),
      systems: scanSystems(workspace, packages),
      effects: scanEffects(workspace, packages),
      tags: scanTags(workspace, modules),
    }),
    options.cwd,
  );
}
