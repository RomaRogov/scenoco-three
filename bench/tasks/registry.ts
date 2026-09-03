/**
 * The task suite.
 *
 * A task is a sentence someone would actually type, plus an oracle that decides whether it
 * happened. The oracle is never shown to the agent — it is the examiner, not the brief.
 *
 * Two properties make a task honest, and both are checked by `oracle/pristine.test.ts`:
 *
 *  - its oracle **fails on an untouched arm**. An oracle that already passes is measuring
 *    nothing, and it is an easy mistake to make: assert something the game happens to do and the
 *    task looks solved before anyone starts.
 *  - its oracle is **arm-neutral**. It imports the seam and nothing else.
 *
 * `favours` records, before any run, which arm the task was expected to suit. A suite made only
 * of tasks the framework wins is a demo; writing the expectation down first is what stops the
 * results being read backwards afterwards.
 */
export interface Task {
  id: string;
  /** The request, as a person would type it. Nothing about XML, components or three.js. */
  prompt: string;
  /** What the task exercises, for the report. */
  probes: string;
  /** Where it was expected to land, recorded before the first run. */
  favours: 'scenoco' | 'code' | 'neither';
}

export const TASKS: readonly Task[] = [
  {
    id: 'crate-value',
    prompt: 'A crate should be worth 3 points instead of 1.',
    probes: 'the smallest possible change, in whichever place a value lives',
    favours: 'neither',
  },
  {
    id: 'heavy-crate',
    prompt:
      'The crate at x 6, z 3 should be a heavy one: it is worth 5 points on its own, and while ' +
      'you are carrying it you move at half speed.',
    probes: 'a second kind of thing, and a rule that couples it to movement',
    favours: 'neither',
  },
  {
    id: 'crate-grid',
    prompt:
      'Lay the crates out in a 4 by 4 grid instead of scattering them — 16 crates, evenly ' +
      'spaced 4 apart, centred on the arena.',
    probes: 'repetition: a loop in code, or sixteen placements in a document',
    favours: 'code',
  },
  {
    id: 'second-depot',
    prompt: 'Add a second depot pad at x 0, z -7. It banks crates exactly like the first one.',
    probes: 'scene composition — adding an object that behaviour then has to notice',
    favours: 'scenoco',
  },
  {
    id: 'stack-cap',
    prompt:
      'The player can carry at most 5 crates. With a full stack, walking over another crate ' +
      'leaves it where it is.',
    probes: 'a state rule with no visual component',
    favours: 'neither',
  },
  {
    id: 'time-bonus',
    prompt: 'Every delivery should add 5 seconds to the clock.',
    probes: 'a rule crossing two systems that already exist',
    favours: 'neither',
  },
  {
    id: 'full-stack-tint',
    prompt:
      'Turn the player red while it is carrying 3 or more crates, and back to blue below that.',
    probes: 'material state driven by game state — the first task with something to look at',
    favours: 'neither',
  },
  {
    id: 'ground-shader',
    prompt:
      'Give the ground a custom shader: a subtle grid of thin lines every 2 units, so the arena ' +
      'reads as a measured space.',
    probes: 'dropping to GLSL — where a document format has least to offer',
    favours: 'code',
  },
  {
    id: 'moving-depot',
    prompt:
      'Make the depot drift slowly back and forth along the x axis, between -4 and 4, taking ' +
      'about 8 seconds for a full round trip.',
    probes: 'animation over time — naturally imperative',
    favours: 'code',
  },
  {
    id: 'repair',
    prompt:
      'The project does not build. Fix it, changing as little as possible, and leave the game ' +
      'behaving exactly as it did.',
    probes: 'diagnostics: how far the error is from its cause',
    favours: 'scenoco',
  },
];
