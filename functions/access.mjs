import { editorFromRequest } from '../server/lib/auth.mjs';
import {
  getStore,
  getAuthConfig,
  jsonResponse,
  errorResponse,
} from '../server/lib/function-kit.mjs';

/**
 * GET /.netlify/functions/access
 * Confirms the caller's Supabase Auth session (Authorization: Bearer <jwt>)
 * and returns the organisation that user is linked to through
 * organisations.owner_id.
 */
export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { error: 'Method not allowed.' });
    }
    const { baseUrl, apiKey } = getAuthConfig();
    const editor = await editorFromRequest({
      authorization: event.headers.authorization || event.headers.Authorization,
      baseUrl,
      apiKey,
      store: getStore(),
    });
    if (!editor) {
      return jsonResponse(401, { error: 'Sign in to edit your organisation.' });
    }
    return jsonResponse(200, {
      organisationId: editor.organisation.slug,
      organisationName: editor.organisation.name,
      email: editor.user.email,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
