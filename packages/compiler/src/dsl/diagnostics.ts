/**
 * A single problem found while parsing, validating, or compiling a scene.
 * Diagnostics carry a source position so agents driving the engine with plain
 * file tools (grep, line edits) can jump straight to the offending line.
 */
export interface SncDiagnostic {
  /** 1-based line in the source XML. */
  line: number;
  /** 1-based column in the source XML. */
  column: number;
  /** Stable machine-readable category, e.g. "unknown-tag". */
  code: string;
  /** Human- and LLM-actionable description: what's wrong and how to fix it. */
  message: string;
  /** Set when the problem is in a referenced file (a resource or prefab), not the scene. */
  file?: string;
  /**
   * What to run `scenoco describe` on, set only when the message itself is a dead end.
   *
   * Carried rather than appended, so the pointer can be printed **once per run** instead of once
   * per problem. Twenty unknown attributes on the same tag are twenty reasons to look the tag up
   * and one line's worth of advice; repeating it on every line is how a diagnostic block stops
   * being read.
   */
  ask?: string;
}

/** tsc-style `file:line:col` rendering, e.g. `scene.xml:12:6  unknown-tag  ...`. */
export function formatDiagnostic(d: SncDiagnostic, file = '<scene>'): string {
  return `${d.file ?? file}:${d.line}:${d.column}  ${d.code}  ${d.message}`;
}

/** Levenshtein-nearest candidate within a small edit distance, for "did you mean" hints. */
export function nearestName(input: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = editDistance(input, c);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  // A real option with something added to it — `stretchCenter` is `stretch` plus a word — is that
  // option, not whichever sibling is fewest edits away (`stretchLeft`). Unless a one-letter typo is
  // closer still.
  if (bestDist > 1) {
    const lower = input.toLowerCase();
    const prefix = candidates
      .filter((c) => c.length >= 4 && c.length < input.length && lower.startsWith(c.toLowerCase()))
      .sort((a, b) => b.length - a.length)[0];
    if (prefix) return prefix;
  }
  // Only suggest when the typo is plausibly a typo, not an unrelated word.
  const threshold = Math.max(2, Math.floor(input.length / 3));
  return best !== undefined && bestDist <= threshold ? best : undefined;
}

/** One hint, chosen from several, never combined. */
export interface Hint {
  /** Appended to the message. Empty when nothing short enough would have helped. */
  text: string;
  /** Set instead of `text` when the answer is too big to inline. See {@link SncDiagnostic.ask}. */
  ask?: string;
}

/** Above this many attributes, a list stops being an answer and starts being a wall. */
const INLINE_LIMIT = 12;

/**
 * The most useful thing that fits on the end of one line.
 *
 * Three answers in strict order of decisiveness, and exactly one of them is used. A misspelling
 * gets "did you mean", which is the whole fix. A small vocabulary gets named, because reading it
 * is cheaper than asking for it. Everything else gets nothing on the line and a pointer in the
 * summary — `<Mesh>` has thirty-odd attributes, and a truncated list of them tells a reader
 * neither what is there nor that anything is missing.
 *
 * The ordering is the economy: a hint that answers the question makes the pointer redundant, and
 * emitting both trains the reader to skim past both.
 */
export function hint(options: {
  /** The near-miss, if the caller found one. */
  near?: string;
  /** How to spell it back: a tag reads `<Mesh>`, an attribute reads `"position"`. */
  as: 'tag' | 'attribute';
  /** The name whose vocabulary answers this, for `scenoco describe`. */
  ask: string;
  /** The full vocabulary, when the caller has it and it might be short enough to name. */
  takes?: readonly string[];
}): Hint {
  const { near, as, ask, takes } = options;
  if (near !== undefined) {
    return { text: as === 'tag' ? ` Did you mean <${near}>?` : ` Did you mean "${near}"?` };
  }
  if (takes) {
    if (takes.length === 0) return { text: ' It takes no attributes.' };
    if (takes.length <= INLINE_LIMIT) return { text: ` It takes: ${takes.join(', ')}.` };
  }
  return { text: '', ask };
}

/**
 * The distinct things worth looking up across a whole run, in the order they were first hit.
 *
 * Deduplicated because the same tag is usually wrong several times in a row, and a summary that
 * repeats itself is a summary nobody finishes reading.
 */
export function whatToLookUp(diagnostics: readonly SncDiagnostic[]): string[] {
  const seen: string[] = [];
  for (const d of diagnostics) {
    if (d.ask !== undefined && !seen.includes(d.ask)) seen.push(d.ask);
  }
  return seen;
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}
