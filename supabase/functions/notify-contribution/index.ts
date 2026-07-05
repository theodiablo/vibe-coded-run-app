// notify-contribution — emails the maintainer when a user contributes a race /
// edition, files a report, or flags an AI coach answer as wrong, and thanks the
// contributor (contribution types only). Invoked best-effort from the client
// (src/notify.js `notifyContribution`) right after the DB row is written; it is
// NEVER on the critical path. If the SES credentials are unset the function
// returns `{ skipped: true }` and the write still stands — the row in
// races / race_editions / race_reports / coach_feedback is the source of truth.
//
// Transport is AWS SES (v2 send API), signed with SigV4 via aws4fetch — no SDK,
// no SMTP. The runtime IAM user is least-privilege: ses:SendEmail only, locked to
// the FromAddress (see docs / the plan for the policy).
//
// Deploy:  supabase functions deploy notify-contribution
// Secrets: supabase secrets set SES_AWS_ACCESS_KEY_ID=... SES_AWS_SECRET_ACCESS_KEY=...
//          (optional: SES_REGION [default eu-west-1], FROM_EMAIL, MAINTAINER_EMAIL).
//          Without the SES key pair this is a no-op.
//
// The caller's JWT is forwarded by supabase.functions.invoke, so we resolve the
// contributor's email server-side from the token rather than trusting the body.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const MAINTAINER_EMAIL = Deno.env.get("MAINTAINER_EMAIL") ?? "theo.camboulive.dev@gmail.com";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Running Coach <noreply@camboulive.solutions>";
const SES_REGION = Deno.env.get("SES_REGION") ?? "eu-west-1";
const CONFIG_SET = Deno.env.get("SES_CONFIG_SET") ?? "runapp-notify";

const SES_ACCESS_KEY_ID = Deno.env.get("SES_AWS_ACCESS_KEY_ID");
const SES_SECRET_ACCESS_KEY = Deno.env.get("SES_AWS_SECRET_ACCESS_KEY");
const hasSesCreds = Boolean(SES_ACCESS_KEY_ID && SES_SECRET_ACCESS_KEY);

const aws = hasSesCreds
  ? new AwsClient({
      accessKeyId: SES_ACCESS_KEY_ID!,
      secretAccessKey: SES_SECRET_ACCESS_KEY!,
      region: SES_REGION,
      service: "ses",
    })
  : null;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function sendEmail(to: string, subject: string, text: string) {
  if (!aws) return false;
  const res = await aws.fetch(
    `https://email.${SES_REGION}.amazonaws.com/v2/email/outbound-emails`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        FromEmailAddress: FROM_EMAIL,
        Destination: { ToAddresses: [to] },
        ConfigurationSetName: CONFIG_SET,
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: "UTF-8" },
            Body: { Text: { Data: text, Charset: "UTF-8" } },
          },
        },
      }),
    },
  );
  if (!res.ok) console.error("ses failed", res.status, await res.text());
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

    if (!hasSesCreds) return json({ skipped: "no SES credentials configured" });

    const kind = String(payload.type ?? "contribution");
    const summary = JSON.stringify(payload, null, 2);

    // 1) Maintainer notice.
    if (kind === "coach_feedback") {
      await sendEmail(
        MAINTAINER_EMAIL,
        "Running Coach — coach feedback",
        `A user flagged an AI coach answer as wrong.\n\nContributor: ${contributorEmail ?? "unknown"}\n\n${summary}\n\nReview alongside the full round context (rationale, tool_calls, input_context) via the join query in docs/coach-agent.md, run against coach_feedback / agent_rounds in the Supabase SQL editor.`,
      );
    } else {
      await sendEmail(
        MAINTAINER_EMAIL,
        `Running Coach — new race ${kind}`,
        `A user submitted a race ${kind}.\n\nContributor: ${contributorEmail ?? "unknown"}\n\n${summary}\n\nReview in the Supabase dashboard (races / race_editions / race_reports).`,
      );
    }

    // 2) Thank-you to the contributor (reports and coach feedback are
    // anonymous-ish / already acknowledged in-app; skip the email there).
    if (contributorEmail && kind !== "report" && kind !== "coach_feedback") {
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
