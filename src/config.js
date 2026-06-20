// Supabase project config.
// If you're running your own copy, change the two values below to match
// your Supabase project (Settings → API in the Supabase dashboard).
// You can also override them at build time via VITE_SUPABASE_URL /
// VITE_SUPABASE_ANON_KEY in a .env.local file — the env vars take precedence.
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://jpnxghiyjpuqnznxyfaf.supabase.co";

// The anon key is public-safe: it grants nothing on its own.
// Row-Level Security on app_state / profiles is the real security boundary.
export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_TfqcHK58CUJtm79HT8-BMg_dx_b3Lhs";
