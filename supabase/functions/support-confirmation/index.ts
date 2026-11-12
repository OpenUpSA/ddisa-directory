// ============================================================================
// DDISA Support Desk — confirmation email via Brevo
// ----------------------------------------------------------------------------
// Supabase Edge Function. Publish/deploy it under the EXACT name:
//
//     support-confirmation
//
// The DDISA backend (server/lib/support-desk.mjs, production mode) POSTs
// { to, subject, text, html } to
//     {SUPABASE_URL}/functions/v1/support-confirmation
// with the service-role key as the Bearer token (JWT verification stays at
// its default ON setting — do not disable it).
//
// Configure these secrets in Supabase (Dashboard → Edge Functions → Secrets,
// or `supabase secrets set NAME=value ...`):
//
//     BREVO_API_KEY          Brevo SMTP/API key (Brevo → SMTP & API → API keys)
//     SUPPORT_EMAIL_FROM     verified sender address, e.g. support@ddisafund.org
//     SUPPORT_EMAIL_REPLY_TO optional reply-to address
//
// The Brevo sender must be verified in Brevo (Senders & IP) or delivery
// fails with Brevo error 400 "unknown sender".
// ============================================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_BODY_CHARS = 250_000; // generous cap: confirmation emails are a few KB

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  const brevoKey = Deno.env.get("BREVO_API_KEY");
  const from = Deno.env.get("SUPPORT_EMAIL_FROM");
  const replyTo = Deno.env.get("SUPPORT_EMAIL_REPLY_TO") || "";
  if (!brevoKey || !from) {
    return json(500, {
      error: "The support-confirmation function is missing BREVO_API_KEY or SUPPORT_EMAIL_FROM secrets.",
    });
  }

  let payload: { to?: unknown; subject?: unknown; text?: unknown; html?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "Send a JSON body." });
  }

  const to = String(payload?.to ?? "").trim();
  const subject = String(payload?.subject ?? "").trim();
  const text = String(payload?.text ?? "");
  const html = String(payload?.html ?? "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return json(400, { error: '"to" must be a valid email address.' });
  }
  if (!subject || subject.length > 300) {
    return json(400, { error: '"subject" is required and must be 300 characters or fewer.' });
  }
  if (!text.trim()) {
    return json(400, { error: '"text" (plain-text body) is required.' });
  }
  if (text.length + html.length > MAX_BODY_CHARS) {
    return json(413, { error: "The email body is too large." });
  }

  const body: Record<string, unknown> = {
    sender: { email: from, name: "DDISA Support Desk" },
    to: [{ email: to }],
    subject,
    textContent: text,
  };
  if (html) body.htmlContent = html;
  if (replyTo) body.replyTo = { email: replyTo };

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": brevoKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      return json(502, {
        error: result?.message || `Brevo returned ${response.status}.`,
      });
    }
    return json(200, { ok: true, messageId: result?.messageId ?? "" });
  } catch (error) {
    return json(502, { error: `Brevo could not be reached: ${error?.message ?? error}` });
  }
});
