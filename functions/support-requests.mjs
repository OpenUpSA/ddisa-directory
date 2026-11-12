import { normaliseSupportRequest, cleanSupportAttachment } from '../server/lib/support-desk.mjs';
import {
  getSupportDesk,
  jsonResponse,
  errorResponse,
  parseJsonBody,
  clientIp,
  RateLimiter,
} from '../server/lib/function-kit.mjs';

const rateLimiter = new RateLimiter();

/**
 * POST /.netlify/functions/support-requests
 * Validates a Support Desk submission and hands it to SupportDeskService:
 * preview mode stores the ticket under .data/, production mode writes to
 * Supabase and runs the Trello / Resend / Slack notifications.
 */
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { error: 'Method not allowed.' });
    }
    if (rateLimiter.isLimited(`support:${clientIp(event)}`, 6, 60 * 60 * 1000)) {
      return jsonResponse(429, {
        error: 'Too many support requests from this connection. Try again later.',
      });
    }

    const body = parseJsonBody(event);
    let payload;
    let attachment;
    try {
      payload = normaliseSupportRequest(body);
      attachment = cleanSupportAttachment(body.attachment);
    } catch (error) {
      error.status = 400;
      throw error;
    }

    const result = await getSupportDesk().submit(payload, attachment);
    return jsonResponse(201, {
      ok: true,
      message: 'Your support request has been logged.',
      ...result,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
