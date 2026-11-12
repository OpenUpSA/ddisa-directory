import { getPublicConfig, jsonResponse } from '../server/lib/function-kit.mjs';

/**
 * GET /.netlify/functions/config
 * Returns the public Supabase connection settings (URL + anon key) for the
 * sign-in UI. The anon key is public by design; the service-role key is
 * never included.
 */
export async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed.' });
  }
  return jsonResponse(200, getPublicConfig());
}
