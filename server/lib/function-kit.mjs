import { loadEnv } from './env.mjs';
import { SupabaseStore } from './supabase-store.mjs';
import { SupportDeskService } from './support-desk.mjs';

let store;
let supportDesk;
let envLoaded = false;

/**
 * Local-dev convenience: pick up the project .env when present. Production
 * (Netlify) injects env natively, and `netlify dev` loads .env itself.
 * Uses process.cwd() — never the module URL, which esbuild empties in the
 * CommonJS bundles Netlify ships (it crashed every function at load time).
 */
function ensureLocalEnv() {
  if (envLoaded) return;
  envLoaded = true;
  try {
    loadEnv(process.cwd());
  } catch {
    // Missing .env is normal in production.
  }
}

/**
 * Supabase store for serverless handlers. Reads env natively on Netlify and
 * falls back to the project .env for local runs.
 * Never expose SUPABASE_SERVICE_ROLE_KEY to the browser — functions only.
 */
export function getStore() {
  ensureLocalEnv();
  if (!store) {
    store = new SupabaseStore({
      baseUrl: process.env.SUPABASE_URL,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
  }
  return store;
}

export function getAuthConfig() {
  ensureLocalEnv();
  return {
    baseUrl: process.env.SUPABASE_URL || '',
    apiKey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  };
}

/**
 * Safe-to-expose Supabase settings for the browser (anon key only — never
 * the service-role key). Used by the sign-in UI when window.DDISA_ENV is
 * unavailable.
 */
export function getPublicConfig() {
  ensureLocalEnv();
  return {
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  };
}

/**
 * Support Desk service for the support-requests function. Preview mode
 * stores tickets under .data/; SUPPORT_DESK_MODE=production requires the
 * Supabase, Trello, Resend and Slack environment variables.
 */
export function getSupportDesk() {
  ensureLocalEnv();
  if (!supportDesk) {
    supportDesk = new SupportDeskService({ root: process.cwd() });
  }
  return supportDesk;
}

export function jsonResponse(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

export function errorResponse(error) {
  const status = error.status || 500;
  const message =
    status < 500 ? error.message : 'The directory could not complete that request.';
  if (status >= 500) console.error(error);
  return jsonResponse(status, { error: message });
}

export function parseJsonBody(event) {
  if (!event.body) return {};
  const text = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  try {
    return JSON.parse(text || '{}');
  } catch {
    const error = new Error('Send a valid JSON request body.');
    error.status = 400;
    throw error;
  }
}

export function clientIp(event) {
  const headers = event.headers || {};
  const netlifyIp = headers['x-nf-client-connection-ip'] || headers['X-Nf-Client-Connection-Ip'];
  if (netlifyIp) return netlifyIp;
  const forwarded = headers['x-forwarded-for'] || headers['X-Forwarded-For'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return event.requestContext?.identity?.sourceIp || 'unknown';
}

/**
 * Best-effort per-instance rate limiting (same policy as the reference
 * server). Durable limits + bot protection arrive with Turnstile later.
 */
export class RateLimiter {
  constructor() {
    this.windows = new Map();
  }

  isLimited(key, limit, windowMs) {
    const now = Date.now();
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      if (this.windows.size > 10_000) this.windows.clear();
      return false;
    }
    current.count += 1;
    return current.count > limit;
  }
}
