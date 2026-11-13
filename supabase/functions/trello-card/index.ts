// ============================================================================
// DDISA Support Desk — create a Trello card (relay)
// ----------------------------------------------------------------------------
// Supabase Edge Function. Publish/deploy it under the EXACT name:
//
//     trello-card
//
// The DDISA backend (server/lib/support-desk.mjs) POSTs { name, desc } to
//     {SUPABASE_URL}/functions/v1/trello-card
// with the service-role key as the Bearer token (JWT verification stays at
// its default ON setting — do not disable it).
//
// Configure these secrets in Supabase (Dashboard → Edge Functions → Secrets,
// or `supabase secrets set ...`):
//
//     TRELLO_KEY     Trello API key   (https://trello.com/app-key)
//     TRELLO_TOKEN   Trello member token           (https://trello.com/1/token authorize)
//     TRELLO_LIST_ID The target list id            (open the list → .json at the end of the URL)
//
// The card is created in that list; the response carries { cardId, url } so
// the ticket row can store trello_card_id / trello_card_url.
// ============================================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_NAME = 500; // Trello card name limit
const MAX_DESC = 16_000; // Trello description limit is 16384

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

  const key = Deno.env.get("TRELLO_KEY");
  const token = Deno.env.get("TRELLO_TOKEN");
  const listId = Deno.env.get("TRELLO_LIST_ID");
  if (!key || !token || !listId) {
    return json(500, {
      error:
        "The trello-card function is missing TRELLO_KEY, TRELLO_TOKEN or TRELLO_LIST_ID secrets.",
    });
  }

  let payload: { name?: unknown; desc?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "Send a JSON body." });
  }

  const name = String(payload?.name ?? "").trim();
  const desc = String(payload?.desc ?? "");
  if (!name || name.length > MAX_NAME) {
    return json(400, { error: `"name" is required and must be ${MAX_NAME} characters or fewer.` });
  }
  if (desc.length > MAX_DESC) {
    return json(400, { error: `"desc" must be ${MAX_DESC} characters or fewer.` });
  }

  const params = new URLSearchParams({
    key,
    token,
    idList: listId,
    name,
    desc,
  });

  try {
    const response = await fetch(`https://api.trello.com/1/cards?${params}`, {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      return json(502, { error: result?.message || `Trello returned ${response.status}.` });
    }
    return json(200, {
      ok: true,
      cardId: result?.id ?? "",
      url: result?.shortUrl || result?.url || "",
    });
  } catch (error) {
    return json(502, { error: `Trello could not be reached: ${error?.message ?? error}` });
  }
});
