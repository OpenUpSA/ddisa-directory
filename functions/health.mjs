import { getStore, jsonResponse, errorResponse } from '../server/lib/function-kit.mjs';

/** GET /.netlify/functions/health — smoke-check the Supabase connection. */
export async function handler() {
  try {
    const health = await getStore().health();
    return jsonResponse(200, { ok: true, mode: 'netlify', ...health });
  } catch (error) {
    return errorResponse(error);
  }
}
