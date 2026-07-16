// Pure CLI-arg helpers (no vite imports), so they're unit-testable.

/** Split a comma-separated list, trimming blanks. */
export function parseList(v: string | undefined): string[] | undefined {
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
}

/** Flags that take a value; other `--flags` are booleans (`''`), the rest positionals. */
export const VALUE_FLAGS: Record<string, string> = {
  '--components': 'components',
  '--packages': 'packages',
  '--port': 'port',
};

export function parseArgs(args: string[]): { positionals: string[]; options: Record<string, string> } {
  const positionals: string[] = [];
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg in VALUE_FLAGS) {
      options[VALUE_FLAGS[arg]!] = args[++i] ?? '';
    } else if (arg.startsWith('--')) {
      options[arg.slice(2)] = ''; // boolean flag, e.g. --verbose
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, options };
}
