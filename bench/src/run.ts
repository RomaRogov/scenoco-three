import { execFile, spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PROTO_TASKS } from '../proto/tasks.ts';
import { TASKS } from '../tasks/registry.ts';

const exec = promisify(execFile);
const BENCH = fileURLToPath(new URL('..', import.meta.url));

/**
 * One cell of the study: one arm, one task, one harness, one attempt.
 *
 * The agent works in an **isolated copy** of the arm, with `node_modules` symlinked back so the
 * project is still itself — its compiler, its types and its tag vocabulary all come from there.
 *
 * Isolation is not tidiness, it is validity. Run in place, the harness walks up to `bench/` as the
 * project root, and the first pilot did exactly that: the agent working on the vanilla arm grepped
 * the whole tree, read `arms/scenoco/src/Round.ts` and `arms/r3f/src/Yard.tsx`,
 * and announced it would change the scoring in all three arms. It could have read the oracle that
 * grades it. Every number from a run like that is worthless.
 */
export interface Cell {
  arm: string;
  task: string;
  harness: 'opencode' | 'claude';
  attempt: number;
  /**
   * Which study this cell belongs to.
   *
   * `game` edits a finished game; `proto` adds to a starter project. They are different questions
   * and they share every piece of machinery except the arms, the tasks and the oracle — so the
   * suite is a field rather than a fork.
   */
  suite: 'game' | 'proto';
}

export interface Result extends Cell {
  /** The task's own oracle is satisfied. */
  passed: boolean;
  /** The project compiles and typechecks. */
  built: boolean;
  /** The core invariants still hold: the game was not broken while being changed. */
  regressed: boolean;
  /**
   * The headline. The agent **changed something**, stopped, the build is clean, and the task is
   * not done — so nothing in the loop told it, and nothing could have.
   *
   * The edit is part of the definition. Without it a run that touched nothing at all scores as
   * silently wrong, which is a different failure wearing the same word: one is a loop that could
   * not see its mistake, the other is a loop that never made one.
   */
  silentlyWrong: boolean;
  /** The agent wrote something. */
  edited: boolean;
  /** The agent was still going when its budget ran out. */
  timedOut: boolean;
  /** The agent modified the grading seam. Reverted before grading, recorded here. */
  seamTouched: boolean;
  /** How many reasoning blocks the model produced. Zero means thinking was off — check the server. */
  reasoningBlocks: number;
  seconds: number;
  /** Lines added + removed across the arm's source. */
  diff: number;
  /** Whatever the harness said on the way past, for reading a run by hand. */
  log: string;
}

/** The files an agent may touch. `node_modules` is not one of them, and neither is the oracle. */
const SOURCE = [
  'src',
  'assets',
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'index.html',
  // The scaffold's own README is part of what a new project hands you, so it is part of what the
  // model is allowed to read.
  'README.md',
];

/**
 * Files the runner owns and the agent must not be judged on.
 *
 * `opencode.json` points the harness at the local model. It is configuration for the experiment,
 * not part of the project under test, so it is restored like everything else but never counted
 * in the diff.
 */
const NOT_THE_PROJECT = ['opencode.json'];

/**
 * The arm-neutral seam. Readable by the agent, but restored before anything is graded.
 *
 * `harness.ts` is not the game — it is the contract the oracle reads the game through, and it is
 * the *same* contract in every arm. Leaving it writable makes the study forgeable in both
 * directions: the r3f pilot cell edited its seam so `score` returned the carried stack times
 * three, which broke grading; an agent one step luckier would have made the oracle report a pass
 * without touching the game at all.
 *
 * It stays in the workspace because reading it is legitimate and equally available to every arm —
 * it is the clearest statement of what the game is supposed to expose. Only the writes are undone,
 * and `seamTouched` records that they happened, because "the agent rewrote the thing measuring it"
 * is a finding rather than an inconvenience.
 */
const SEAM = ['src/harness.ts', 'src/harness.tsx'];

/** One cell's stable identity, used for both its result file and its live log. */
export function cellId(cell: Cell): string {
  return `${cell.suite}-${cell.harness}-${cell.arm}-${cell.task}-${cell.attempt}`;
}

/** Where a suite keeps its arms. */
export function armsRoot(suite: Cell['suite']): string {
  return suite === 'proto' ? join(BENCH, 'proto', 'arms') : join(BENCH, 'arms');
}

/** A suite's oracle files, relative to `bench/`. */
function oracleDir(suite: Cell['suite']): string {
  return suite === 'proto' ? 'proto/oracle' : 'oracle';
}

/** Every task in a suite. */
export function tasksOf(suite: Cell['suite']): readonly { id: string; prompt: string }[] {
  return suite === 'proto' ? PROTO_TASKS : TASKS;
}

/** Where a cell's transcript is written *as it happens*, so a run can be watched rather than awaited. */
export function logPath(cell: Cell): string {
  return join(BENCH, 'results', 'live', `${cellId(cell)}.log`);
}

/** Where a cell's result lands. A cell whose file exists is already done. */
export function resultPath(cell: Cell): string {
  return join(BENCH, 'results', `${cellId(cell)}.json`);
}

export async function runCell(cell: Cell): Promise<Result> {
  const arm = join(armsRoot(cell.suite), cell.arm);
  const task = tasksOf(cell.suite).find((candidate) => candidate.id === cell.task);
  if (!task) throw new Error(`no task called "${cell.task}"`);

  const backup = snapshot(arm);
  const workspace = isolate(arm, `${cell.suite}-${cell.arm}`);
  const started = Date.now();
  const live = logPath(cell);
  mkdirSync(join(BENCH, 'results', 'live'), { recursive: true });
  writeFileSync(live, `# ${cellId(cell)}\n# ${new Date().toISOString()}\n# ${task.prompt}\n\n`);
  let log = '';

  try {
    const attempt = await drive(cell.harness, workspace, task.prompt, live, cellId(cell));
    log = attempt.log;
    // What the agent wrote comes back into the arm, which is where it can be built and graded.
    const seamTouched = adopt(workspace, arm, backup);
    const reasoningBlocks = await captureReasoning(workspace, live, cellId(cell));
    appendFileSync(live, '\n# --- agent finished, grading ---\n');
    const built = await succeeds(arm, ['run', 'check']);
    const regressed = built ? !(await graded(cell.arm, 'core', cell.suite)) : true;
    const passed = built && !regressed && (await graded(cell.arm, cell.task, cell.suite));
    const diff = diffSize(arm, backup.dir);
    appendFileSync(
      live,
      `# built=${built} regressed=${regressed} passed=${passed} diff=${diff}\n# --- done ---\n`,
    );

    return {
      ...cell,
      passed,
      built,
      regressed,
      // Only meaningful when the agent left something that compiles: a failed build is a loud
      // wrongness, and this number is about the quiet kind.
      silentlyWrong: diff > 0 && built && !passed,
      edited: diff > 0,
      timedOut: attempt.timedOut,
      seamTouched,
      reasoningBlocks,
      seconds: Math.round((Date.now() - started) / 1000),
      diff,
      log,
    };
  } finally {
    restore(arm, backup);
    rmSync(backup.dir, { recursive: true, force: true });
    // The workspace is deliberately left behind: it is the evidence for the cell that just ran,
    // and the next cell for this arm wipes it before it copies.
    void workspace;
  }
}

/**
 * Hand the task to the agent under test.
 *
 * Both harnesses drive the *same* local model over the same server; neither was written for this
 * project. The prompt carries the task and how to build, and nothing about XML, components or
 * three.js — the arm is supposed to teach the agent what it is, which is the thing being measured.
 */
/**
 * Hand the task to the agent under test.
 *
 * Both harnesses drive the *same* local model over the same server; neither was written for this
 * project. The prompt carries the task and how to build, and nothing about XML, components or
 * three.js — the arm is supposed to teach the agent what it is, which is the thing being measured.
 *
 * Spawned rather than `execFile`d so output is collected **as it arrives**. A killed process
 * hands back nothing through `execFile`, which meant a cell that ran out of time produced an
 * empty log and no way to see where it had got to — the one run you most need to read.
 */
async function drive(
  harness: Cell['harness'],
  arm: string,
  prompt: string,
  live: string,
  title: string,
): Promise<{ log: string; timedOut: boolean }> {
  const brief = `${prompt}\n\nThe project builds with \`npm run check\`. Stop when it is done.`;
  const budget = Number(process.env['BENCH_TIMEOUT_MS'] ?? 15 * 60 * 1000);

  const [command, args, env] =
    harness === 'opencode'
      ? // `--title` is how the cell finds its own session afterwards. Without it, attribution goes
        // through "newest session in this directory", and three attempts share one workspace path,
        // so a cell could be handed a *different attempt's* reasoning — text that reads perfectly
        // plausibly under the wrong heading.
        (['opencode', ['run', '--title', title, brief], {}] as const)
      : ([
          'claude',
          [
            '--bare',
            '-p',
            brief,
            '--model',
            process.env['BENCH_MODEL'] ?? 'mlx-community/Qwen3.5-9B-MLX-4bit',
            '--permission-mode',
            'acceptEdits',
            '--allowedTools',
            'Read',
            'Edit',
            'Write',
            'Bash',
            '--output-format',
            'json',
          ],
          {
            ANTHROPIC_BASE_URL: process.env['BENCH_BASE_URL'] ?? 'http://127.0.0.1:8081',
            ANTHROPIC_API_KEY: 'local-noop',
          },
        ] as const);

  return new Promise((resolve) => {
    const child = spawn(command, [...args], {
      cwd: arm,
      // `PWD` is inherited, and a tool that trusts it over `process.cwd()` will resolve its
      // project root to wherever the *runner* was started. That is not hypothetical: with it
      // inherited, the agent read the oracle grading it and the runner driving it.
      env: { ...process.env, PWD: arm, ...env },
      // stdin closed, not piped: given an open pipe, opencode waits for input that never arrives
      // and produces not one byte of output before its budget runs out.
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let log = '';
    let timedOut = false;
    const keep = (chunk: Buffer): void => {
      const text = chunk.toString();
      log += text;
      // Appended as it arrives, not at the end: a cell takes minutes, and the only way to know a
      // four-minute silence is thinking rather than hanging is to watch the transcript grow.
      appendFileSync(live, text);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);

    const alarm = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, budget);

    child.on('close', () => {
      clearTimeout(alarm);
      resolve({ log, timedOut });
    });
    child.on('error', (error) => {
      clearTimeout(alarm);
      resolve({ log: `${log}\n${error.message}`, timedOut });
    });
  });
}

/**
 * Pull the model's reasoning out of the session store and into the cell's transcript.
 *
 * Worth the extra seconds because without it a cell records only *what* the model did, never what
 * it believed — and a run read that way invites exactly the confident, wrong story I told twice
 * about why an arm failed. The session has to be exported here, before the next cell wipes the
 * workspace it belongs to.
 *
 * Reasoning is a bonus, never a reason to fail a cell: everything here is best-effort.
 */
async function captureReasoning(workspace: string, live: string, title: string): Promise<number> {
  try {
    const env = { ...process.env, PWD: workspace };
    const { stdout: list } = await exec('opencode', ['session', 'list'], { cwd: workspace, env });
    const ids = list
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('ses_'))
      .map((line) => line.split(/\s+/)[0]!)
      .slice(0, 12);

    // `session list` is **global**, and its order is not dependable, so neither "the newest id"
    // nor "the newest in this directory" identifies a cell: three attempts share one workspace.
    // The cell names its own session with `--title`, and that name is what is matched here.
    const blocks: string[] = [];
    for (const id of ids) {
      const { stdout: raw } = await exec('opencode', ['export', id], {
        cwd: workspace,
        env,
        maxBuffer: 64 * 1024 * 1024,
      });
      // `export` prints a line of its own before the document.
      const start = raw.indexOf('{');
      if (start === -1) continue;
      const doc = JSON.parse(raw.slice(start)) as {
        info?: { title?: string };
        messages?: { parts?: { type?: string; text?: string }[] }[];
      };
      if (doc.info?.title !== title) continue;
      for (const message of doc.messages ?? []) {
        for (const part of message.parts ?? []) {
          if (part.type === 'reasoning' && part.text?.trim()) blocks.push(part.text.trim());
        }
      }
      break;
    }

    if (blocks.length > 0) {
      const body = blocks.map((text, index) => `[${index + 1}] ${text}`).join('\n\n');
      appendFileSync(live, `\n# --- reasoning (${blocks.length} blocks) ---\n${body}\n`);
    }
    return blocks.length;
  } catch {
    return 0;
  }
}

/**
 * `core` is the regression check; a task id runs that task's own oracle.
 *
 * Deliberately **not** `parity.test.ts`. Parity pins the game exactly, and half the task suite
 * asks for one of those exact numbers to change — graded against it, an agent that correctly made
 * a crate worth three would be recorded as having broken the game. `core.test.ts` holds only what
 * no task is allowed to break.
 */
async function graded(arm: string, task: string, suite: Cell['suite']): Promise<boolean> {
  const dir = oracleDir(suite);
  const file = task === 'core' ? `${dir}/core.test.ts` : `${dir}/graded.test.ts`;
  return succeeds(BENCH, ['exec', 'vitest', 'run', file], {
    BENCH_ARM: arm,
    BENCH_TASK: task,
  });
}

async function succeeds(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<boolean> {
  try {
    await exec('npm', args, { cwd, env: { ...process.env, ...env }, maxBuffer: 32 * 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy the parts of an arm an agent may touch.
 *
 * Not every arm has every path — only the SceNoCo arm has `assets/` — so what was actually there
 * is recorded, and restore uses that. Restoring a path that never existed would quietly grow the
 * arm a directory per run.
 */
function snapshot(arm: string): Snapshot {
  const dir = mkdtempSync(join(tmpdir(), 'bench-arm-'));
  const had: string[] = [];
  for (const entry of [...SOURCE, ...NOT_THE_PROJECT]) {
    if (!existsSync(join(arm, entry))) continue;
    cpSync(join(arm, entry), join(dir, entry), { recursive: true, force: true });
    had.push(entry);
  }
  return { dir, had };
}

/**
 * Put the arm back exactly as it was, including deleting anything the agent added.
 *
 * Every path is removed first and then restored from the backup, so a new file inside `src/`
 * goes with it — and a whole directory the agent invented, which was never in `had`, is removed
 * and not put back.
 */
function restore(arm: string, backup: Snapshot): void {
  for (const entry of [...SOURCE, ...NOT_THE_PROJECT]) {
    rmSync(join(arm, entry), { recursive: true, force: true });
    if (backup.had.includes(entry)) {
      cpSync(join(backup.dir, entry), join(arm, entry), { recursive: true, force: true });
    }
  }
}

interface Snapshot {
  dir: string;
  /** Which paths this arm actually had, so restore does not invent the ones it did not. */
  had: string[];
}

/** Where an arm's agent works. Stable, and outside the repo. */
export function workspaceOf(arm: string): string {
  return join(homedir(), '.scenoco-bench', 'work', arm);
}

/**
 * A private copy of the arm for the agent to work in.
 *
 * `node_modules` is symlinked rather than copied: it is hundreds of megabytes per arm, and the
 * point is only that the project resolves its own dependencies. `.git` makes the copy a root the
 * harness will not walk out of, which is what stops it finding its siblings.
 *
 * The path is **stable per arm** rather than a fresh temp directory, for two reasons. A run you
 * cannot watch is a run you have to wait out, and opencode's web interface lists sessions by
 * project directory — a directory that only exists for four minutes can never be opened in it. It
 * also means a cell that failed is still on disk afterwards, at a path you can `cd` into. The cost
 * is that cells for one arm must not run concurrently, which they do not.
 */
function isolate(arm: string, name: string): string {
  const dir = workspaceOf(name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const entry of [...SOURCE, ...NOT_THE_PROJECT]) {
    if (!existsSync(join(arm, entry))) continue;
    cpSync(join(arm, entry), join(dir, entry), { recursive: true, force: true });
  }
  symlinkSync(join(arm, 'node_modules'), join(dir, 'node_modules'), 'dir');
  mkdirSync(join(dir, '.git'), { recursive: true });
  writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  return dir;
}

/**
 * Bring the agent's work back into the arm, so it can be built and graded where it belongs — then
 * put the seam back the way it was. Returns whether the agent had changed it.
 */
function adopt(workspace: string, arm: string, backup: Snapshot): boolean {
  for (const entry of SOURCE) {
    rmSync(join(arm, entry), { recursive: true, force: true });
    if (existsSync(join(workspace, entry))) {
      cpSync(join(workspace, entry), join(arm, entry), { recursive: true, force: true });
    }
  }

  let touched = false;
  for (const seam of SEAM) {
    const original = join(backup.dir, seam);
    if (!existsSync(original)) continue;
    const written = join(arm, seam);
    touched ||= !existsSync(written) || readFileSync(written, 'utf8') !== readFileSync(original, 'utf8');
    cpSync(original, written, { force: true });
  }
  return touched;
}

/** Lines changed, as a cheap measure of how much the agent moved. */
function diffSize(arm: string, backup: string): number {
  try {
    // `diff` exits 1 when files differ, which is the normal case here.
    const { stdout } = spawnSync(
      'diff',
      [
        '-r',
        '-u',
        '--exclude=*.gen.ts',
        '--exclude=node_modules',
        ...NOT_THE_PROJECT.map((name) => `--exclude=${name}`),
        // Restored above, so it is never a difference — excluded so a seam edit cannot inflate
        // `diff` and make a cell that did nothing to the game look like a cell that worked.
        '--exclude=harness.ts',
        '--exclude=harness.tsx',
        backup,
        arm,
      ],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
    return (stdout ?? '').split('\n').filter((line) => /^[+-][^+-]/.test(line)).length;
  } catch {
    return -1;
  }
}

/** Write one result to `results/`, one file per cell, so a sweep is resumable. */
export function record(result: Result): string {
  mkdirSync(join(BENCH, 'results'), { recursive: true });
  const path = resultPath(result);
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
  return path;
}
