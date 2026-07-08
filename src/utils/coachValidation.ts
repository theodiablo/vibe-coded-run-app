// App-side re-export of the SHARED plan validator. The single source of truth
// lives with the edge function (supabase/functions/_shared/coach/) so the
// deployed agent bundles it; the app imports it from here for the client-side
// belt-and-braces check before applying an accepted proposal, and the tests in
// src/utils exercise it against buildPlan output (one validator, two callers).
export {
  validatePlan,
  formatValidation,
  SESSION_TYPES,
  PHASES,
  HARD_TYPES,
} from "../../supabase/functions/_shared/coach/validation.mjs";
