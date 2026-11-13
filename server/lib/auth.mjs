/**
 * Supabase Auth verification for organisation editing.
 *
 * Replaces the old HMAC edit links: the browser signs in with Supabase
 * (GoTrue) and sends its JWT on every editing request; the server confirms
 * the JWT against `{SUPABASE_URL}/auth/v1/user`, then maps the user to an
 * organisation through `organisations.owner_id`.
 */

/** Extract a `Bearer <jwt>` value from an Authorization header. */
export function bearerToken(headerValue) {
  const match = /^Bearer\s+(.+)$/i.exec(String(headerValue || '').trim());
  return match ? match[1].trim() : null;
}

/**
 * Confirm an access token with Supabase Auth.
 * Returns `{ id, email }` for a valid session, `null` when the token is
 * missing/expired/revoked, or throws a 503 when Supabase is unreachable.
 */
export async function verifySupabaseUser({ baseUrl, apiKey, accessToken, fetchImpl = globalThis.fetch }) {
  if (!baseUrl || !accessToken) return null;
  let response;
  try {
    response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/auth/v1/user`, {
      headers: { apikey: apiKey, Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    const error = new Error('Supabase sign-in could not be reached. Try again shortly.');
    error.status = 503;
    throw error;
  }
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) {
    const error = new Error('Supabase sign-in is temporarily unavailable. Try again shortly.');
    error.status = 502;
    throw error;
  }
  const user = await response.json().catch(() => null);
  if (!user || !user.id) return null;
  return { id: user.id, email: user.email || '' };
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

/**
 * Resolve the signed-in editor (if any) for a request.
 *
 * Returns `null` when the request carries no Authorization header — the
 * caller treats that as a public, anonymous submission. Otherwise returns
 * `{ user, organisation, access }` where `access` is the shape
 * `normaliseSubmission` expects (`{ sub: slug, name }`), or throws:
 *   501 — no Supabase backend configured
 *   401 — invalid/expired session
 *   403 — signed in, but no organisation linked to this user
 */
export async function editorFromRequest({ authorization, baseUrl, apiKey, store }) {
  const accessToken = bearerToken(authorization);
  if (!accessToken) return null;
  if (!baseUrl) {
    fail(501, 'Profile editing requires the Supabase application backend.');
  }
  const user = await verifySupabaseUser({ baseUrl, apiKey, accessToken });
  if (!user) {
    fail(401, 'Your session has expired. Please sign in again.');
  }
  const organisation = await store.findOrganisationByOwner(user.id);
  if (!organisation) {
    fail(403, 'Your account is not linked to an organisation yet. Ask DDISA to connect your account.');
  }
  return {
    user,
    organisation,
    access: { sub: organisation.slug, name: organisation.name },
  };
}
