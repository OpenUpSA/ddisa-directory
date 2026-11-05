import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './lib/env.mjs';
import { SupabaseStore } from './lib/supabase-store.mjs';
import { PreviewStore } from './lib/preview-store.mjs';
import { verifyProfileToken, tokenMatchesOrganisation } from './lib/tokens.mjs';
import { cleanImage } from './lib/validation.mjs';
import {
  normaliseSubmission,
  normaliseCollaborationRequest,
  handleSubmit,
} from './lib/submissions.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
loadEnv(root);

const port = Number(process.env.PORT || 3000);
const hasSupabaseEnv = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const mode = process.env.DB_MODE || (hasSupabaseEnv ? 'supabase' : 'preview');
const directoryFile = process.env.DIRECTORY_FILE || 'DDISA - Grantee Directory.html';
const tokenSecret =
  process.env.PROFILE_LINK_SECRET ||
  (mode === 'preview' ? 'local-preview-secret-change-before-deploying' : '');

if (!['supabase', 'preview'].includes(mode)) {
  throw new Error('DB_MODE must be either "supabase" or "preview".');
}
if (mode === 'supabase') {
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!process.env[key] || process.env[key].startsWith('replace-')) {
      throw new Error(`${key} must be configured when using Supabase.`);
    }
  }
}
if (!tokenSecret) {
  throw new Error('PROFILE_LINK_SECRET must be configured.');
}

const store =
  mode === 'supabase'
    ? new SupabaseStore({
        baseUrl: process.env.SUPABASE_URL,
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      })
    : new PreviewStore(root);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const requestWindows = new Map();

function isRateLimited(request, bucket, limit, windowMs) {
  const forwarded = request.headers['x-forwarded-for'];
  const address = String(Array.isArray(forwarded) ? forwarded[0] : forwarded || request.socket.remoteAddress)
    .split(',')[0]
    .trim();
  const key = `${bucket}:${address}`;
  const now = Date.now();
  const current = requestWindows.get(key);
  if (!current || current.resetAt <= now) {
    requestWindows.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  current.count += 1;
  return current.count > limit;
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request, limit = 30 * 1024 * 1024) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('Request body is too large.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    const error = new Error('Send a valid JSON request body.');
    error.status = 400;
    throw error;
  }
}

async function serveStatic(requestPath, response) {
  const requested = requestPath === '/' || requestPath === ''
    ? directoryFile
    : decodeURIComponent(requestPath.slice(1));
  const publicFiles = new Set([
    directoryFile,
    'DDISA - Grantee Directory - Shareable.html',
    'DDISA - Developer Prototype.html',
  ]);
  const isAsset = requested.startsWith('assets/')
    && !requested.includes('\0')
    && !requested.split('/').includes('..');
  if (!publicFiles.has(requested) && !isAsset) {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }
  const filePath = resolve(root, requested);
  const rootPrefix = `${root}${sep}`;
  if (filePath !== resolve(root, directoryFile) && !filePath.startsWith(rootPrefix)) {
    sendJson(response, 403, { error: 'Forbidden.' });
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('Not a file');
    const body = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': requested.startsWith('assets/') ? 'public, max-age=86400' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    response.end(body);
  } catch {
    sendJson(response, 404, { error: 'Not found.' });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  try {
    if (request.method === 'GET' && url.pathname === '/api/health') {
      sendJson(response, 200, {
        ok: true,
        mode,
        ...(await store.health()),
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/directory') {
      sendJson(response, 200, {
        records: await store.listDirectory(),
        source: mode,
        generatedAt: new Date().toISOString(),
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/access') {
      const payload = verifyProfileToken(url.searchParams.get('token'), tokenSecret);
      if (!payload) {
        sendJson(response, 401, { error: 'This edit link is invalid or has expired.' });
        return;
      }
      const organisation = await store.findOrganisation(payload.sub);
      if (!organisation) {
        sendJson(response, 404, { error: 'The organisation could not be found.' });
        return;
      }
      if (!tokenMatchesOrganisation(payload, organisation)) {
        sendJson(response, 401, {
          error: 'This edit link has been revoked. Request a new link from DDISA.',
        });
        return;
      }
      sendJson(response, 200, {
        organisationId: payload.sub,
        organisationName: organisation.name,
        expiresAt: new Date(payload.exp * 1000).toISOString(),
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/submissions') {
      if (isRateLimited(request, 'submission', 8, 60 * 60 * 1000)) {
        sendJson(response, 429, { error: 'Too many submissions from this connection. Try again later.' });
        return;
      }

      const body = await readJsonBody(request);
      let access = null;
      if (body.accessToken) {
        access = verifyProfileToken(body.accessToken, tokenSecret);
        if (!access) {
          sendJson(response, 401, { error: 'This edit link is invalid or has expired.' });
          return;
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
      if (access) {
        const organisation = await store.findOrganisation(access.sub);
        if (!organisation) {
          sendJson(response, 404, { error: 'The organisation could not be found.' });
          return;
        }
        if (!tokenMatchesOrganisation(access, organisation)) {
          sendJson(response, 401, {
            error: 'This edit link has been revoked. Request a new link from DDISA.',
          });
          return;
        }
      }
      const submission = await handleSubmit(store, payload, photo, logo);
      sendJson(response, 201, {
        ok: true,
        message: 'Your update has been sent to DDISA for review.',
        submissionId: submission.id,
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/collaboration-requests') {
      if (isRateLimited(request, 'collaboration', 8, 60 * 60 * 1000)) {
        sendJson(response, 429, { error: 'Too many collaboration requests from this connection. Try again later.' });
        return;
      }
      const body = await readJsonBody(request, 100 * 1024);
      let payload;
      try {
        payload = normaliseCollaborationRequest(body);
      } catch (error) {
        error.status = 400;
        throw error;
      }
      if (typeof store.createCollaborationRequest !== 'function') {
        sendJson(response, 501, {
          error: 'Collaboration requests require the Supabase application backend.',
        });
        return;
      }
      await store.createCollaborationRequest(payload);
      sendJson(response, 201, {
        ok: true,
        message: 'Your collaboration request has been received.',
      });
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { error: 'Method not allowed.' });
      return;
    }

    await serveStatic(url.pathname, response);
  } catch (error) {
    console.error(error);
    sendJson(response, error.status || 500, {
      error:
        error.status && error.status < 500
          ? error.message
          : 'The directory could not complete that request.',
    });
  }
});

server.listen(port, () => {
  console.log(`DDISA directory running at http://localhost:${port} (${mode} data mode)`);
  if (mode === 'preview') {
    console.log(
      'Preview submissions are stored under .data/. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to use Supabase.',
    );
  }
});
