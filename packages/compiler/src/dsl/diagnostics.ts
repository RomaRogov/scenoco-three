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
  // Only suggest when the typo is plausibly a typo, not an unrelated word.
  const threshold = Math.max(2, Math.floor(input.length / 3));
  return best !== undefined && bestDist <= threshold ? best : undefined;
}

/**
 * What the thing *does* take, for when the near-miss check found nothing to suggest.
 *
 * A misspelling gets "did you mean"; an attribute borrowed from somewhere else gets nothing, and
 * "has no field" on its own is a dead end — the class is in a package, not in the project, so
 * there is nowhere for a reader to look it up. Naming the vocabulary is the answer, and it is
 * only affordable where the vocabulary is small: a component, a system, an effect.
 */
export function fieldsItTakes(names: readonly string[], limit = 12): string {
  if (names.length === 0) return ' It takes no attributes.';
  const shown = names.slice(0, limit).join(', ');
  return ` It takes: ${shown}${names.length > limit ? ', …' : ''}.`;
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
