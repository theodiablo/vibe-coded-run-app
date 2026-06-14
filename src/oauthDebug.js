// TEMPORARY DIAGNOSTIC INSTRUMENTATION — for tracking down the Google OAuth
// "stuck on splash spinner after redirect" bug. Safe to delete this whole file
// (and its imports in App.jsx / db.js / supabase.js) once the cause is found.
//
// Everything here is gated behind a flag so it can be left in place harmlessly:
// it's ON by default while we debug. To silence without removing code, set
// VITE_OAUTH_DEBUG=false at build time, or run `localStorage.oauthDebug='off'`
// in the console.

const FLAG_ENV = import.meta.env.VITE_OAUTH_DEBUG;
function enabled() {
  try {
    if (localStorage.getItem("oauthDebug") === "off") return false;
  } catch {
    /* ignore */
  }
  return FLAG_ENV === undefined ? true : String(FLAG_ENV) !== "false";
}

const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
function elapsed() {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  return `+${Math.round(now - t0)}ms`;
}

// Loud, timestamped log. The "[oauth-debug]" prefix makes it trivial to filter
// in the browser console.
export function dlog(...args) {
  if (!enabled()) return;
  console.log(`%c[oauth-debug ${elapsed()}]`, "color:#fb923c;font-weight:bold", ...args);
}

// One-shot snapshot of everything relevant to the redirect: the URL (does it
// still carry ?code= / a hash / an error?), and the Supabase auth keys in
// localStorage (is the session persisted? is the PKCE code-verifier present or
// already consumed?). Call this on load and again after a state change to diff.
export function snapshotAuthState(label) {
  if (!enabled()) return;
  let url = {};
  try {
    const u = new URL(window.location.href);
    url = {
      href: u.href,
      hasCode: u.searchParams.has("code"),
      code: u.searchParams.get("code")?.slice(0, 8) ?? null,
      error: u.searchParams.get("error"),
      error_description: u.searchParams.get("error_description"),
      hash: u.hash || null,
    };
  } catch {
    /* ignore */
  }

  const storage = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith("sb-") || k.includes("auth-token") || k.includes("code-verifier")) {
        const v = localStorage.getItem(k);
        storage[k] = v ? `present(len=${v.length})` : v;
      }
    }
  } catch {
    /* ignore */
  }

  dlog(`SNAPSHOT [${label}]`, { url, storage });
}
