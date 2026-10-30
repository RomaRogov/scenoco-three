#!/usr/bin/env node
/**
 * scenoco-unity <unity-project> [--root <game>] [--headed]
 *
 * Writes the game's prefabs, scenes, meshes and materials into a Unity project: Unity builds them
 * with its own API the next time it compiles (or from the menu, SceNoCo ▸ Import).
 */
import { resolve } from 'node:path';
import { snapshotProject, writeUnity } from './export.js';

const args = process.argv.slice(2);
const usage = 'usage: scenoco-unity <unity-project> [--root <game>] [--headed]';
if (args.includes('--help') || args.includes('-h')) {
  console.log(usage);
  process.exit(0);
}
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const headed = args.includes('--headed');
if (headed) args.splice(args.indexOf('--headed'), 1);
const root = resolve(flag('--root') ?? '.');
const project = args[0];

// An option it does not know is a mistake, not a project's name.
const unknown = args.find((a) => a.startsWith('-'));
if (!project || args.length > 1 || unknown) {
  console.error(unknown ? `scenoco-unity: no option ${unknown}\n${usage}` : usage);
  process.exit(2);
}

try {
  const snap = await snapshotProject(root, { headed });
  const { converted, scripts, modules, warnings } = await writeUnity(snap, project, root);
  const d = converted.data;
  console.log(`${d.prefabs.length} prefabs, ${d.scenes.length} scenes, ${d.meshes.length} meshes, ${d.materials.length} materials → ${resolve(project)}`);
  if (scripts.length) console.log(`C# stubs for ${scripts.join(', ')} in Assets/Scripts — the fields are wired, each method holds its TypeScript to port.`);
  if (modules.length) console.log(`The rest of the code, as TypeScript in Assets/Scripts/Modules: ${modules.map((m) => m.replace(/^\/src\//, '')).join(', ')}.`);
  if (d.ui && Object.keys(d.ui.documents).length) console.log(`The page as UXML and USS in Assets/UI: ${Object.values(d.ui.documents).join(', ')}.`);
  for (const w of warnings) console.log(`warning: ${w}`);
  console.log('Porting rules: Assets/SceNoCo/PORTING.md. Driving the game in Play mode: unity command scenoco.help (needs com.unity.pipeline).');
  for (const w of d.warnings) console.log(`warning: ${w}`);
  console.log('Unity builds them when it next compiles, or from SceNoCo ▸ Import.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
