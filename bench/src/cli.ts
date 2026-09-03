import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { record, resultPath, runCell, tasksOf, type Cell } from './run.ts';

/**
 * Run cells and write the results.
 *
 * Resumable by construction: one file per cell, and a cell whose file already exists is skipped.
 * A sweep is hours long and a machine that goes to sleep in the middle of one should cost you the
 * cell it was on, not the sweep.
 */
const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : (args[at + 1] ?? fallback);
};

const suite = flag('suite', 'game') as Cell['suite'];
const arms = flag('arms', 'vanilla,r3f,scenoco').split(',');
const tasks = flag(
  'tasks',
  tasksOf(suite)
    .map((task) => task.id)
    .join(','),
).split(',');
const harness = flag('harness', 'opencode') as Cell['harness'];
const attempts = Number(flag('attempts', '1'));

/**
 * The prototype suite is meant to be watchable in one sitting, so its cells get five minutes
 * rather than fifteen. Three stacks, one task, a quarter of an hour end to end — short enough
 * that a bad design shows up before a night has been spent on it.
 */
if (suite === 'proto') process.env['BENCH_TIMEOUT_MS'] ??= String(5 * 60 * 1000);

const cells: Cell[] = [];
for (let attempt = 1; attempt <= attempts; attempt++) {
  for (const task of tasks) for (const arm of arms) cells.push({ arm, task, harness, attempt, suite });
}

/**
 * Refuse to start unless every arm is pristine.
 *
 * `pristine.test.ts` asserts that every task's oracle *fails* on an untouched arm — which is the
 * same thing as asserting no task has already been done. That is not a theoretical guard: an
 * un-isolated probe once left `* 3` in two arms, and because the sweep restores each arm from a
 * snapshot taken at the start of its own cell, the pre-solved state was faithfully preserved into
 * every cell that followed. Two arms spent a pilot measuring a task they had already been given
 * the answer to, and the run looked entirely healthy while they did it.
 *
 * A sweep is hours long, so the cost of this check is nothing and the cost of skipping it is
 * every number the sweep produces.
 */
try {
  execFileSync('npx', ['vitest', 'run', 'oracle/pristine.test.ts'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'pipe',
  });
} catch {
  console.error(
    'refusing to run: an arm is not pristine — some task is already solved in the source.\n' +
      'run `npx vitest run oracle/pristine.test.ts` in bench/ to see which.',
  );
  process.exit(1);
}

console.log(
  `${cells.length} cells: ${suite} · ${harness} · ${arms.join(', ')} · ${tasks.length} tasks\n`,
);

for (const [index, cell] of cells.entries()) {
  const label = `${index + 1}/${cells.length} ${cell.suite} ${cell.arm} ${cell.task} #${cell.attempt}`;

  // The resumability the header promises, actually implemented. A sweep is hours long; re-running
  // a cell that already has a result would also *overwrite* it, so this is about not losing work
  // as much as not repeating it.
  if (!args.includes('--force') && existsSync(resultPath(cell))) {
    console.log(`${label} … skipped (already recorded)`);
    continue;
  }

  process.stdout.write(`${label} … `);

  const result = await runCell(cell).catch((error: unknown) => {
    // A cell that blows up is a result, not a crash: recorded, reported, and the sweep goes on.
    console.log(`ERRORED — ${error instanceof Error ? error.message : String(error)}`);
    return {
      ...cell,
      passed: false,
      built: false,
      regressed: true,
      silentlyWrong: false,
      edited: false,
      timedOut: false,
      seamTouched: false,
      reasoningBlocks: 0,
      seconds: 0,
      diff: -1,
      log: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error),
    };
  });

  const verdict = result.passed
    ? 'passed'
    : result.regressed
      ? 'REGRESSED'
      : result.silentlyWrong
        ? 'SILENTLY WRONG'
        : result.edited
          ? 'failed to build'
          : 'no edit';
  const note = `${result.timedOut ? ', timed out' : ''}${result.seamTouched ? ', TOUCHED SEAM' : ''}`;
  console.log(`${verdict}  (${result.seconds}s, ${result.diff} lines${note})`);
  record(result);
}
