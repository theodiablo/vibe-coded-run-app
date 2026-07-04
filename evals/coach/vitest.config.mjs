// Standalone Vitest config for the live coach eval (npm run eval:live).
// Separate from the root config so `npm test` never picks these up (they cost
// real API calls) and so they run in a plain node environment — no jsdom, no
// React setup. Vitest's transform still provides import.meta.env, which
// src/constants.js (pulled in via buildPlan) needs.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["evals/coach/*.eval.test.js"],
    environment: "node",
    testTimeout: 600_000,
    hookTimeout: 60_000,
  },
});
