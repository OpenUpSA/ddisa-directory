import { normaliseCollaborationRequest } from '../server/lib/submissions.mjs';
import {
  getStore,
  jsonResponse,
  errorResponse,
  parseJsonBody,
  clientIp,
  RateLimiter,
} from '../server/lib/function-kit.mjs';

const rateLimiter = new RateLimiter();

/**
 * POST /.netlify/functions/collaboration-requests
 * Persists the request (consent flag included). Recipient notification
 * arrives with the email-service integration.
 */
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { error: 'Method not allowed.' });
    }
    if (rateLimiter.isLimited(`collaboration:${clientIp(event)}`, 8, 60 * 60 * 1000)) {
      return jsonResponse(429, {
        error: 'Too many collaboration requests from this connection. Try again later.',
      });
    }

    const body = parseJsonBody(event);
    let payload;
    try {
      payload = normaliseCollaborationRequest(body);
    } catch (error) {
      error.status = 400;
      throw error;
    }

    await getStore().createCollaborationRequest(payload);
    return jsonResponse(201, {
      ok: true,
      message: 'Your collaboration request has been received.',
    });
  } catch (error) {
    return errorResponse(error);
  }
}
