import { verifyProfileToken, tokenMatchesOrganisation } from '../server/lib/tokens.mjs';
import {
  getStore,
  getTokenSecret,
  jsonResponse,
  errorResponse,
} from '../server/lib/function-kit.mjs';

/**
 * GET /.netlify/functions/access?token=...
 * Verifies a signed edit link and returns the organisation it unlocks.
 */
export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { error: 'Method not allowed.' });
    }
    const token = event.queryStringParameters?.token || '';
    const payload = verifyProfileToken(token, getTokenSecret());
    if (!payload) {
      return jsonResponse(401, { error: 'This edit link is invalid or has expired.' });
    }
    const organisation = await getStore().findOrganisation(payload.sub);
    if (!organisation) {
      return jsonResponse(404, { error: 'The organisation could not be found.' });
    }
    if (!tokenMatchesOrganisation(payload, organisation)) {
      return jsonResponse(401, {
        error: 'This edit link has been revoked. Request a new link from DDISA.',
      });
    }
    return jsonResponse(200, {
      organisationId: payload.sub,
      organisationName: organisation.name,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
