import { defineConfig } from 'vitest/config';

/**
 * The oracle, run separately from the repo's own suite.
 *
 * Each arm is a standalone project with its own `node_modules`, so these cannot run until the
 * arms are installed — which is why `npm test` at the repo root does not pick them up.
 */
export default defineConfig({
  test: {
    // Both suites: `oracle/` grades the game arms, `proto/oracle/` the from-scratch
    // scaffolds. A glob rather than a list — an allowlist naming files is how a new test file
    // ends up never running and nobody notices.
    include: ['oracle/**/*.test.ts', 'proto/oracle/**/*.test.ts'],
    environment: 'node',
    // Loading four scene graphs and stepping them is not fast, and a slow machine should not
    // turn a correctness suite into a flake.
    testTimeout: 30_000,
  },
});
