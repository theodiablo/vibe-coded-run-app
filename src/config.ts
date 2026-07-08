// Supabase project config. Set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY at
// build time, or in a local .env.local file for development. The fallback is
// the Supabase CLI local stack URL so tests and local imports have a valid URL
// without hardcoding a hosted project ref.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "http://127.0.0.1:54321";

// The anon key is public-safe: it grants nothing on its own.
// Row-Level Security on app_state / profiles is the real security boundary.
export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_TfqcHK58CUJtm79HT8-BMg_dx_b3Lhs";
