// notify-contribution — emails the maintainer when a user contributes a race /
// edition or files a report, and thanks the contributor. Invoked best-effort from
// the client (src/races.js `notifyContribution`) right after the DB row is
// written; it is NEVER on the critical path. If RESEND_API_KEY is unset the
// function returns `{ skipped: true }` and the contribution still stands — the
// row in races / race_editions / race_reports is the source of truth.
//
// Deploy:  supabase functions deploy notify-contribution
// Secrets: supabase secrets set RESEND_API_KEY=...   (optional: MAINTAINER_EMAIL,
//          FROM_EMAIL).  Without RESEND_API_KEY this is a no-op.
//
// The caller's JWT is forwarded by supabase.functions.invoke, so we resolve the
// contributor's email server-side from the token rather than trusting the body.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAINTAINER_EMAIL = Deno.env.get("MAINTAINER_EMAIL") ?? "theo.camboulive.dev@gmail.com";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Running Coach <onboarding@resend.dev>";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function sendEmail(to: string, subject: string, text: string) {
  if (!RESEND_API_KEY) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, text }),
  });
  if (!res.ok) console.error("resend failed", res.status, await res.text());
  return res.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const payload = await req.json().catch(() => ({}));

    // Resolve the contributor's email from their JWT (don't trust the body).
    let contributorEmail: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data } = await supabase.auth.getUser();
      contributorEmail = data?.user?.email ?? null;
    }

    if (!RESEND_API_KEY) return json({ skipped: "no RESEND_API_KEY configured" });

    const kind = String(payload.type ?? "contribution");
    const summary = JSON.stringify(payload, null, 2);

    // 1) Maintainer notice.
    await sendEmail(
      MAINTAINER_EMAIL,
      `Running Coach — new race ${kind}`,
      `A user submitted a race ${kind}.\n\nContributor: ${contributorEmail ?? "unknown"}\n\n${summary}\n\nReview in the Supabase dashboard (races / race_editions / race_reports).`,
    );

    // 2) Thank-you to the contributor (reports are anonymous-ish; still acknowledge).
    if (contributorEmail && kind !== "report") {
      await sendEmail(
        contributorEmail,
        "Thanks for adding a race to Running Coach",
        `Thanks for contributing "${payload.name ?? "your race"}" to the shared race catalogue!\n\nIt's live for everyone right now, tagged as unverified. We'll review it and let you know once it's verified.\n\n— Running Coach`,
      );
    }

    return json({ ok: true });
  } catch (err) {
    console.error("notify-contribution error", err);
    return json({ error: String(err) }, 200); // never fail the caller
  }
});
