import { createClient } from "@supabase/supabase-js";

// The publishable (anon) key is PUBLIC-safe: it grants nothing on its own.
// Row-Level Security on the `app_state` / `profiles` tables is the real
// boundary — anonymous requests are denied. NEVER put the secret key here.
// Overridable at build time via Vite env vars, with safe defaults baked in so
// the static S3/CloudFront build works without extra workflow config.
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://jpnxghiyjpuqnznxyfaf.supabase.co";
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_TfqcHK58CUJtm79HT8-BMg_dx_b3Lhs";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true },
});

export const authRedirectTo = () => `${window.location.origin}/`;
