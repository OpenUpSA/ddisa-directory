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
 * Resolve the signed-in editor for a request.
 *
 * - No Authorization header → null (anonymous submission).
 * - Owner path: `organisations.owner_id` matches the user → that org only.
 * - Admin path: a member of `support_admins` may edit ANY organisation;
 *   `requestedSlug` (from the client) selects which one. Admins without a
 *   linked organisation get `{ organisation: null, isAdmin: true }` for the
 *   UI-only access check (when `requireOrganisation` is false).
 *
 * Returns `{ user, organisation, access, isAdmin }` where `access` is the
 * shape `normaliseSubmission` expects (`{ sub: slug, name }`), or throws:
 *   501 — no Supabase backend configured
 *   401 — invalid/expired session
 *   404 — admin requested an organisation that does not exist
 *   400 — admin edit without a requested organisation
 *   403 — signed in, but not allowed to edit that organisation
 */
export async function editorFromRequest({
  authorization,
  baseUrl,
  apiKey,
  store,
  requestedSlug = '',
  requireOrganisation = false,
}) {
  const accessToken = bearerToken(authorization);
  if (!accessToken) return null;
  if (!baseUrl) {
    fail(501, 'Profile editing requires the Supabase application backend.');
  }
  const user = await verifySupabaseUser({ baseUrl, apiKey, accessToken });
  if (!user) {
    fail(401, 'Your session has expired. Please sign in again.');
  }

  const ownerOrganisation = await store.findOrganisationByOwner(user.id);
  const wantsOther = Boolean(requestedSlug) && ownerOrganisation?.slug !== requestedSlug;
  if (ownerOrganisation && !wantsOther) {
    return {
      user,
      organisation: ownerOrganisation,
      access: { sub: ownerOrganisation.slug, name: ownerOrganisation.name },
      isAdmin: false,
    };
  }

  const isAdmin = await store.isSupportAdmin(user.id);
  if (isAdmin) {
    if (!requestedSlug) {
      if (requireOrganisation) {
        fail(400, 'Choose an organisation to edit (organisationId is required).');
      }
      // UI-only access check for an admin with no linked organisation.
      return { user, organisation: null, access: null, isAdmin: true };
    }
    const organisation = await store.findOrganisation(requestedSlug);
    if (!organisation) {
      fail(404, 'The organisation could not be found.');
    }
    return {
      user,
      organisation,
      access: { sub: organisation.slug, name: organisation.name },
      isAdmin: true,
    };
  }

  if (ownerOrganisation) {
    // Signed-in owner asking for a different organisation — deny.
    fail(403, 'Your account can only edit its linked organisation.');
  }
  fail(403, 'Your account is not linked to an organisation yet. Ask DDISA to connect your account.');
}
