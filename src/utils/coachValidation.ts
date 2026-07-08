// App-side re-export of the SHARED plan validator. The single source of truth
// lives with the edge function (supabase/functions/_shared/coach/) so the
// deployed agent bundles it; the app imports it from here for the client-side
// belt-and-braces check before applying an accepted proposal, and the tests in
// src/utils exercise it against buildPlan output (one validator, two callers).
// @ts-expect-error Shared Deno/Vitest ESM has no TypeScript declaration file.
import * as sharedValidation from "../../supabase/functions/_shared/coach/validation.mjs";

type ValidationExports = {
  validatePlan: (plan: unknown, opts?: unknown) => { ok: boolean; errors?: unknown[]; warnings?: unknown[] };
  formatValidation: (result: unknown) => string;
  SESSION_TYPES: readonly string[];
  PHASES: readonly string[];
  HARD_TYPES: readonly string[];
};

const validation = sharedValidation as ValidationExports;

export const { validatePlan, formatValidation, SESSION_TYPES, PHASES, HARD_TYPES } = validation;
