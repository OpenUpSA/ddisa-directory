import { editorFromRequest } from '../server/lib/auth.mjs';
import { normaliseSubmission, handleSubmit } from '../server/lib/submissions.mjs';
import { cleanImage } from '../server/lib/validation.mjs';
import {
  getStore,
  getAuthConfig,
  jsonResponse,
  errorResponse,
  parseJsonBody,
  clientIp,
  RateLimiter,
} from '../server/lib/function-kit.mjs';

const rateLimiter = new RateLimiter();

/**
 * POST /.netlify/functions/submissions
 * Profile updates (with a Supabase Auth session) and new organisations are
 * validated server-side and published directly to Supabase, mirroring the
 * reference server's contract.
 */
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { error: 'Method not allowed.' });
    }
    if (rateLimiter.isLimited(`submission:${clientIp(event)}`, 8, 60 * 60 * 1000)) {
      return jsonResponse(429, {
        error: 'Too many submissions from this connection. Try again later.',
      });
    }

    const body = parseJsonBody(event);
    // A Bearer header means "editing my organisation"; no header means a
    // public, anonymous new-organisation submission. Admins send
    // organisationId so the resolver knows which profile to publish.
    let access = null;
    try {
      const { baseUrl, apiKey } = getAuthConfig();
      const editor = await editorFromRequest({
        authorization: event.headers.authorization || event.headers.Authorization,
        baseUrl,
        apiKey,
        store: getStore(),
        requestedSlug: body.organisationId || '',
        requireOrganisation: true,
      });
      access = editor ? editor.access : null;
    } catch (error) {
      return errorResponse(error);
    }

    let payload;
    let photo;
    let logo;
    try {
      payload = normaliseSubmission(body, access);
      photo = cleanImage(body.photo, 'Organisation photo');
      logo = body.logo ? cleanImage(body.logo, 'Organisation logo') : null;
    } catch (error) {
      error.status = 400;
      throw error;
    }

    const submission = await handleSubmit(getStore(), payload, photo, logo);
    return jsonResponse(201, {
      ok: true,
      message: access
        ? 'Your changes have been published to your public profile.'
        : 'Your organisation has been published to the directory.',
      submissionId: submission.id,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
