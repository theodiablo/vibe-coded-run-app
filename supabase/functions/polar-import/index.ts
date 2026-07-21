// polar-import — server side of the Polar (AccessLink) cloud import.
//
// Why server-side: OAuth needs the Polar client SECRET, which can never ship in
// the SPA bundle (same rule as coach-agent's Anthropic key). The user's long-
// lived Polar access token is stored in `polar_tokens` (service-role-only RLS)
// and never returned to the client — the client only ever receives finished
// runs. Strava is excluded because its terms ban AI use of API data and the
// coach reads runs; Polar's agreement has no such clause (see docs).
//
// Actions (JSON body { action, ... }, caller JWT forwarded by functions.invoke):
//   status              → { connected }
//   exchange { code, redirectUri }
//                       → swap an OAuth code for a token, register the user with
//                         AccessLink, store it. → { connected: true }
//   sync                → pull new exercises via a transaction and return each
//                         one's summary + GPX text for the CLIENT to parse with
//                         its existing tested GPX parser. → { exercises: [...] }
//   disconnect          → forget the stored token. → { ok: true }
//
// Deploy:  supabase functions deploy polar-import
// Secrets: supabase secrets set POLAR_CLIENT_ID=... POLAR_CLIENT_SECRET=...
//          Without them every action returns { skipped } and the client provider
//          stays invisible (VITE_POLAR_CLIENT_ID unset) — a safe no-op.
//
// NOTE: this talks to Polar's live cloud, which can't be exercised in CI or the
// dev sandbox — verify end-to-end once a Polar app is registered (docs/
// integrations-polar.md). The AccessLink calls follow Polar's documented v3 API.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const POLAR_CLIENT_ID = Deno.env.get("POLAR_CLIENT_ID");
const POLAR_CLIENT_SECRET = Deno.env.get("POLAR_CLIENT_SECRET");
const hasPolarCreds = Boolean(POLAR_CLIENT_ID && POLAR_CLIENT_SECRET);

const TOKEN_URL = "https://polarremote.com/v2/oauth2/token";
const API = "https://www.polaraccesslink.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ── Polar AccessLink calls ─────────────────────────────────────────────────

// Exchange an authorization code for a long-lived access token (+ x_user_id).
async function exchangeCode(code: string, redirectUri: string) {
  const basic = btoa(`${POLAR_CLIENT_ID}:${POLAR_CLIENT_SECRET}`);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });
  if (!res.ok) throw new Error(`polar token exchange failed: ${res.status} ${await res.text()}`);
  return await res.json() as { access_token: string; x_user_id?: number };
}

// Register the authenticated user with AccessLink (required once before pulling
// data). A 409 means already registered — not an error. member-id just has to be
// a stable per-user string; we use the Supabase user id.
async function registerUser(token: string, memberId: string, xUserId?: number): Promise<string> {
  const res = await fetch(`${API}/v3/users`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ "member-id": memberId }),
  });
  if (res.ok) {
    const body = await res.json() as { "polar-user-id"?: number };
    if (body["polar-user-id"] != null) return String(body["polar-user-id"]);
  } else if (res.status !== 409) {
    throw new Error(`polar user registration failed: ${res.status} ${await res.text()}`);
  }
  // Already registered (409) or no id in the body: fall back to x_user_id from
  // the token response, which is the same AccessLink user id.
  if (xUserId != null) return String(xUserId);
  throw new Error("polar user id unavailable after registration");
}

// One exercise's summary + GPX (route + HR extensions). GPX is 404 for an
// indoor/treadmill run — return null so the client still imports the summary.
async function fetchExercise(token: string, uri: string) {
  const auth = { "Authorization": `Bearer ${token}` };
  const summaryRes = await fetch(uri, { headers: { ...auth, "Accept": "application/json" } });
  if (!summaryRes.ok) return null;
  const summary = await summaryRes.json();
  let gpx: string | null = null;
  try {
    const gpxRes = await fetch(`${uri}/gpx`, { headers: { ...auth, "Accept": "application/gpx+xml" } });
    if (gpxRes.ok) gpx = await gpxRes.text();
  } catch { /* no route — summary-only */ }
  return { id: String((summary as { id?: unknown })?.id ?? ""), summary, gpx };
}

// Pull all not-yet-transacted exercises via the AccessLink transaction lifecycle:
// create → list → fetch each → commit (advances Polar's "new" cursor). 204 on
// create means nothing new. Client-side extId dedupe is the safety net if a
// commit lands but the client save doesn't.
async function pullExercises(token: string, polarUserId: string) {
  const base = `${API}/v3/users/${polarUserId}/exercise-transactions`;
  const auth = { "Authorization": `Bearer ${token}` };
  const createRes = await fetch(base, { method: "POST", headers: { ...auth, "Accept": "application/json" } });
  if (createRes.status === 204) return []; // no new data
  if (!createRes.ok) throw new Error(`polar transaction create failed: ${createRes.status} ${await createRes.text()}`);
  const created = await createRes.json() as { "transaction-id"?: number | string };
  const txId = created["transaction-id"];
  if (txId == null) return [];
  const txUrl = `${base}/${txId}`;

  const listRes = await fetch(txUrl, { headers: { ...auth, "Accept": "application/json" } });
  // If the LIST fails, do NOT commit — that would advance Polar's cursor past
  // exercises we never fetched, losing them forever. Leave the transaction open;
  // the next sync re-creates it with the same exercises.
  if (!listRes.ok) return [];
  const list = await listRes.json() as { exercises?: string[] };
  const uris = Array.isArray(list.exercises) ? list.exercises : [];

  const exercises: Array<{ id: string; summary: unknown; gpx: string | null }> = [];
  let allFetched = true;
  for (const uri of uris) {
    const ex = await fetchExercise(token, uri).catch(() => null);
    if (ex && ex.id) exercises.push(ex);
    else allFetched = false; // a transient per-exercise failure — don't commit yet
  }
  // Only commit (advance Polar's "new" cursor) when EVERY listed exercise came
  // back. On a partial fetch we leave the transaction open so the missed ones are
  // re-offered next sync; client-side extId dedupe drops the ones already saved,
  // so re-listing is harmless — but committing on a partial fetch would silently
  // lose the un-fetched runs.
  if (allFetched) await fetch(txUrl, { method: "PUT", headers: auth }).catch(() => {});
  return exercises;
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const payload = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = typeof payload.action === "string" ? payload.action : "status";

    // Resolve the caller from their JWT (forwarded by functions.invoke).
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: auth } = await userClient.auth.getUser();
    const user = auth?.user;
    if (!user) return json({ error: "unauthorized" }, 401);

    if (!hasPolarCreds) return json({ skipped: "polar not configured", connected: false });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const loadToken = async () => {
      const { data } = await admin.from("polar_tokens")
        .select("polar_user_id, access_token").eq("user_id", user.id).maybeSingle();
      return data as { polar_user_id: string; access_token: string } | null;
    };

    if (action === "status") {
      return json({ connected: !!(await loadToken()) });
    }

    if (action === "disconnect") {
      await admin.from("polar_tokens").delete().eq("user_id", user.id);
      return json({ ok: true });
    }

    if (action === "exchange") {
      const code = typeof payload.code === "string" ? payload.code : "";
      const redirectUri = typeof payload.redirectUri === "string" ? payload.redirectUri : "";
      if (!code || !redirectUri) return json({ error: "code and redirectUri are required" }, 400);
      const tok = await exchangeCode(code, redirectUri);
      const polarUserId = await registerUser(tok.access_token, user.id, tok.x_user_id);
      const { error } = await admin.from("polar_tokens").upsert({
        user_id: user.id,
        polar_user_id: polarUserId,
        access_token: tok.access_token,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      return json({ connected: true });
    }

    if (action === "sync") {
      const token = await loadToken();
      if (!token) return json({ exercises: [], connected: false });
      const exercises = await pullExercises(token.access_token, token.polar_user_id);
      return json({ exercises, connected: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (err) {
    console.error("polar-import error", err);
    return json({ error: String(err) }, 200); // never hard-fail the caller's scan
  }
});
