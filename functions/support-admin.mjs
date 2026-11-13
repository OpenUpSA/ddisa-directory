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
 * Support desk admin console API.
 *
 *   GET  /.netlify/functions/support-admin
 *        → { admin: { email }, tickets: [...] }          (all tickets, newest first)
 *   GET  /.netlify/functions/support-admin?ticket=<id>
 *        → { url, expiresIn }                           (signed attachment link, 1h)
 *   POST /.netlify/functions/support-admin
 *        { action: 'status',  ticketId, status }         → { ok, ticketId, status }
 *        { action: 'forward', ticketId }                 → { ok, ticketId, cardId, url, ... }
 *
 * Every call requires `Authorization: Bearer <supabase access token>` from a
 * user listed in public.support_admins — otherwise 401 (no/expired session)
 * or 403 (not an admin). The JWT is verified against GoTrue server-side.
 */
export async function handler(event) {
  try {
    const service = getSupportDesk();

    if (event.httpMethod === 'GET') {
      const admin = await service.verifyAdmin(
        event.headers.authorization || event.headers.Authorization,
      );
      const ticket = event.queryStringParameters?.ticket;
      if (ticket) {
        return jsonResponse(200, await service.signAttachment(ticket));
      }
      return jsonResponse(200, {
        admin: { email: admin.email },
        tickets: await service.listTickets(),
        organisations: await service.listOrganisationsForAdmin(),
      });
    }

    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { error: 'Method not allowed.' });
    }
    if (rateLimiter.isLimited(`support-admin:${clientIp(event)}`, 60, 60 * 1000)) {
      return jsonResponse(429, {
        error: 'Too many admin actions from this connection. Try again later.',
      });
    }
    await service.verifyAdmin(event.headers.authorization || event.headers.Authorization);

    const body = parseJsonBody(event);
    let result;
    if (body.action === 'status') {
      result = await service.setTicketStatus(body.ticketId, body.status);
    } else if (body.action === 'forward') {
      result = await service.forwardTicketToTrello(body.ticketId);
    } else if (body.action === 'link-owner') {
      result = await service.linkOrganisationOwner(body.organisationSlug, body.email);
    } else if (body.action === 'unlink-owner') {
      result = await service.unlinkOrganisationOwner(body.organisationSlug);
    } else {
      return jsonResponse(400, {
        error: 'Action must be "status", "forward", "link-owner" or "unlink-owner".',
      });
    }
    return jsonResponse(200, { ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
