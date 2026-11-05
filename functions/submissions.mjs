import { verifyProfileToken, tokenMatchesOrganisation } from '../server/lib/tokens.mjs';
import { normaliseSubmission, handleSubmit } from '../server/lib/submissions.mjs';
import { cleanImage } from '../server/lib/validation.mjs';
import {
  getStore,
  getTokenSecret,
  jsonResponse,
  errorResponse,
  parseJsonBody,
  clientIp,
  RateLimiter,
} from '../server/lib/function-kit.mjs';

const rateLimiter = new RateLimiter();

/**
 * POST /.netlify/functions/submissions
 * Profile updates (with a valid edit token) and new organisations are
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
    let access = null;
    if (body.accessToken) {
      access = verifyProfileToken(body.accessToken, getTokenSecret());
      if (!access) {
        return jsonResponse(401, { error: 'This edit link is invalid or has expired.' });
      }
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

    const store = getStore();
    if (access) {
      const organisation = await store.findOrganisation(payload.organisationId);
      if (!organisation) {
        return jsonResponse(404, { error: 'The organisation could not be found.' });
      }
      if (!tokenMatchesOrganisation(access, organisation)) {
        return jsonResponse(401, {
          error: 'This edit link has been revoked. Request a new link from DDISA.',
        });
      }
    }

    const submission = await handleSubmit(store, payload, photo, logo);
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
