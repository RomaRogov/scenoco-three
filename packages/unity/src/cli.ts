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

if (!project || args.length > 1) {
  console.error('usage: scenoco-unity <unity-project> [--root <game>] [--headed]');
  process.exit(2);
}

try {
  const snap = await snapshotProject(root, { headed });
  const { converted, scripts } = writeUnity(snap, project, root);
  const d = converted.data;
  console.log(`${d.prefabs.length} prefabs, ${d.scenes.length} scenes, ${d.meshes.length} meshes, ${d.materials.length} materials → ${resolve(project)}`);
  if (scripts.length) console.log(`C# stubs for ${scripts.join(', ')} in Assets/Scripts — the fields are wired, the logic is yours to port.`);
  for (const w of d.warnings) console.log(`warning: ${w}`);
  console.log('Unity builds them when it next compiles, or from SceNoCo ▸ Import.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
