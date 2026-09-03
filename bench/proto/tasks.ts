/**
 * The prototype suite: what a model can *add* to a running starter.
 *
 * Different question from `tasks/registry.ts`, which edits a finished game. Here every stack
 * begins at the same place — a lit, turning cube on a ground — and the task is the first thing
 * you would actually type after `npm create`. That is the moment a framework is either learnable
 * or not, and it is the moment the earlier suite never reached: two nights of runs were spent
 * watching a model hunt for a file rather than author anything.
 *
 * Tasks are deliberately small. A 9B model has minutes, not hours, and a task it cannot finish
 * teaches nothing about the format.
 */
export interface ProtoTask {
  id: string;
  /** The request, as a person would type it. Nothing about XML, components or three.js. */
  prompt: string;
  /** What it exercises, for the report. */
  probes: string;
  /** Where it was expected to land, recorded before the first run. */
  favours: 'scenoco' | 'code' | 'neither';
}

export const PROTO_TASKS: readonly ProtoTask[] = [
  {
    id: 'pillars',
    prompt:
      'Add three stone pillars to the scene. Each one must be a cylinder named "pillar", ' +
      'standing on the ground, placed at x = -3, x = 0 and x = 3.',
    probes: 'placing new shapes, and knowing how tall a shape is before you can stand it on a floor',
    favours: 'neither',
  },
  {
    id: 'stack',
    prompt:
      'Stack five cubes on top of one another in the middle of the scene. Each cube must be ' +
      'named "brick", and the bottom one must rest on the ground.',
    probes: 'repetition, and arithmetic over a shape size',
    favours: 'neither',
  },
  {
    id: 'moon',
    prompt: 'Add a sphere named "moon" that continuously circles around the turning cube.',
    probes: 'authoring behaviour over time, not just structure',
    favours: 'code',
  },
];
