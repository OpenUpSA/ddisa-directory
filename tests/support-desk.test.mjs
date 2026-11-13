import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  buildConfirmationEmail,
  buildSlackMessage,
  buildTrelloCard,
  cleanSupportAttachment,
  normaliseSupportRequest,
  SupportDeskService,
} from '../server/lib/support-desk.mjs';
import { errorResponse } from '../server/lib/function-kit.mjs';
import { handler as supportRequestHandler } from '../functions/support-requests.mjs';

function validRequest(overrides = {}) {
  return {
    requestId: 'qa-request-001',
    fullName: 'Sihle Makanya',
    email: 'sihle@example.org',
    organisation: 'OpenUp',
    country: 'South Africa',
    organisationType: 'Women-led',
    supportType: 'Technical support',
    goal: 'Tool fix or build',
    description: 'The organisation profile will not open in the directory.',
    triedSoFar: 'I refreshed the page and tried a second browser.',
    consent: true,
    ...overrides,
  };
}

test('support request validation accepts the documented form flow', () => {
  const request = normaliseSupportRequest(validRequest());
  assert.equal(request.email, 'sihle@example.org');
  assert.equal(request.supportType, 'Technical support');
  assert.equal(request.goal, 'Tool fix or build');
  assert.equal(request.consent, true);
});

test('support request validation requires consent and conditional Other details', () => {
  assert.throws(
    () => normaliseSupportRequest(validRequest({ consent: false })),
    /agree to submit/i,
  );
  assert.throws(
    () => normaliseSupportRequest(validRequest({ supportType: 'Other' })),
    /Support type details is required/i,
  );
  assert.throws(
    () => normaliseSupportRequest(validRequest({ organisationType: 'Other' })),
    /Organisation type details is required/i,
  );
});

test('support integrations build the documented Trello, email and Slack content', () => {
  const record = {
    ...normaliseSupportRequest(validRequest()),
    ticketId: 'DDISA-20261106-A1B2C3',
    submittedAt: '2026-11-06T08:00:00.000Z',
    source: 'DDISA web support form',
  };
  const trello = buildTrelloCard(record);
  assert.equal(trello.name, 'Support Request - OpenUp');
  assert.match(trello.desc, /Ticket ID: DDISA-20261106-A1B2C3/);
  assert.match(trello.desc, /Organisation: OpenUp/);

  const email = buildConfirmationEmail(record);
  assert.match(email.subject, /DDISA-20261106-A1B2C3/);
  assert.match(email.text, /Dear Sihle/);
  assert.match(email.text, /We have successfully received and logged/);

  const slack = buildSlackMessage(record, 'https://trello.com/c/example');
  assert.match(slack, /New support ticket received: OpenUp/);
  assert.match(slack, /Trello: https:\/\/trello.com\/c\/example/);
});

test('support attachments are limited to 25 MB', () => {
  const tooLarge = Buffer.alloc(25 * 1024 * 1024 + 1).toString('base64');
  assert.throws(
    () => cleanSupportAttachment({
      dataUrl: `data:application/pdf;base64,${tooLarge}`,
      filename: 'sample.pdf',
    }),
    /25 MB or smaller/i,
  );
});

test('preview support requests are stored locally and can be retried safely', async (context) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'ddisa-support-test-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const service = new SupportDeskService({
    root: directory,
    env: { SUPPORT_DESK_MODE: 'preview' },
    now: () => new Date('2026-11-06T08:00:00.000Z'),
  });
  const payload = normaliseSupportRequest(validRequest());
  const first = await service.submit(payload, null);
  const second = await service.submit(payload, null);
  assert.equal(first.ticketId, second.ticketId);
  assert.equal(first.preview, true);
  assert.equal(second.preview, true);
  assert.equal(first.integrations.trello, 'not configured in preview');

  const rows = JSON.parse(await readFile(resolve(directory, '.data', 'support-requests.json'), 'utf8'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ticketId, first.ticketId);
});

test('production support requests create Trello, email and Slack records', async (context) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'ddisa-support-production-test-'));
  context.after(() => rm(directory, { recursive: true, force: true }));

  const calls = [];
  const fetchImpl = async (input, options = {}) => {
    const url = String(input);
    const method = options.method || 'GET';
    calls.push({ url, method, body: options.body || '', headers: options.headers || {} });

    if (url.includes('/rest/v1/support_requests?request_id=eq.')) {
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/rest/v1/support_requests?') && method === 'PATCH') {
      return new Response(null, { status: 204 });
    }
    if (url.endsWith('/rest/v1/support_requests')) {
      return method === 'PATCH'
        ? new Response(null, { status: 204 })
        : new Response('', { status: 201 });
    }
    if (url.startsWith('https://api.trello.com/1/cards?')) {
      return new Response(JSON.stringify({
        id: 'trello-card-1',
        shortUrl: 'https://trello.com/c/qa-card',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/functions/v1/support-confirmation')) {
      return new Response(JSON.stringify({ ok: true, messageId: 'email-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === 'https://hooks.slack.example/support') {
      return new Response('ok', { status: 200 });
    }
    throw new Error(`Unexpected provider request: ${method} ${url}`);
  };

  const service = new SupportDeskService({
    root: directory,
    fetchImpl,
    now: () => new Date('2026-11-06T08:00:00.000Z'),
    env: {
      SUPPORT_DESK_MODE: 'production',
      SUPABASE_URL: 'https://project.supabase.example',
      SUPABASE_SERVICE_ROLE_KEY: 'server-only-key',
      TRELLO_KEY: 'trello-key',
      TRELLO_TOKEN: 'trello-token',
      TRELLO_LIST_ID: 'trello-list',
      SLACK_SUPPORT_WEBHOOK_URL: 'https://hooks.slack.example/support',
    },
  });

  const result = await service.submit(normaliseSupportRequest(validRequest()), null);
  assert.equal(result.preview, false);
  assert.equal(result.integrations.trello.status, 'created');
  assert.equal(result.integrations.email.status, 'sent');
  assert.equal(result.integrations.slack.status, 'sent');

  const trello = calls.find((call) => call.url.startsWith('https://api.trello.com/1/cards?'));
  assert.match(trello.url, /idList=trello-list/);
  assert.match(trello.url, /Support\+Request\+-\+OpenUp/);

  const email = calls.find((call) => call.url.includes('/functions/v1/support-confirmation'));
  assert.ok(email, 'the confirmation email must go through the support-confirmation edge function');
  assert.match(String(email.headers.Authorization || ''), /^Bearer /);
  const emailPayload = JSON.parse(email.body);
  assert.equal(emailPayload.to, 'sihle@example.org');
  assert.match(emailPayload.subject, /DDISA-20261106-/);
  assert.match(emailPayload.text, /Dear Sihle/);

  const slack = calls.find((call) => call.url === 'https://hooks.slack.example/support');
  assert.match(JSON.parse(slack.body).text, /https:\/\/trello.com\/c\/qa-card/);
  assert.equal(
    calls.filter((call) => call.method === 'PATCH' && call.url.includes('/rest/v1/support_requests?')).length,
    1,
  );
});

test('production mode runs with Supabase alone — Trello and Slack are optional', async (context) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'ddisa-support-supabase-only-test-'));
  context.after(() => rm(directory, { recursive: true, force: true }));

  const calls = [];
  const fetchImpl = async (input, options = {}) => {
    const url = String(input);
    const method = options.method || 'GET';
    calls.push({ url, method });
    if (url.includes('/rest/v1/support_requests?request_id=eq.')) {
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/rest/v1/support_requests?') && method === 'PATCH') {
      return new Response(null, { status: 204 });
    }
    if (url.endsWith('/rest/v1/support_requests')) {
      return new Response('', { status: 201 });
    }
    if (url.includes('/functions/v1/support-confirmation')) {
      return new Response(JSON.stringify({ ok: true, messageId: 'email-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`Unexpected provider request: ${method} ${url}`);
  };

  const service = new SupportDeskService({
    root: directory,
    fetchImpl,
    now: () => new Date('2026-11-06T08:00:00.000Z'),
    env: {
      SUPPORT_DESK_MODE: 'production',
      SUPABASE_URL: 'https://project.supabase.example',
      SUPABASE_SERVICE_ROLE_KEY: 'server-only-key',
    },
  });

  const result = await service.submit(normaliseSupportRequest(validRequest()), null);
  assert.equal(result.preview, false);
  assert.equal(result.integrations.trello.status, 'not configured');
  assert.equal(result.integrations.slack.status, 'not configured');
  assert.equal(result.integrations.email.status, 'sent');
  assert.ok(
    !calls.some((call) => call.url.includes('trello.com')),
    'Trello must not be called without credentials',
  );
  assert.ok(
    !calls.some((call) => call.url.includes('hooks.slack')),
    'Slack must not be called without a webhook',
  );
});

test('storage failures surface actionable messages instead of a masked 500', async (context) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'ddisa-support-expose-test-'));
  context.after(() => rm(directory, { recursive: true, force: true }));

  // Simulates the live outage: support_requests table missing (PGRST205 404).
  const service = new SupportDeskService({
    root: directory,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          code: 'PGRST205',
          message: "Could not find the table 'public.support_requests' in the schema cache",
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    env: {
      SUPPORT_DESK_MODE: 'production',
      SUPABASE_URL: 'https://project.supabase.example',
      SUPABASE_SERVICE_ROLE_KEY: 'server-only-key',
    },
  });

  await assert.rejects(
    () => service.submit(normaliseSupportRequest(validRequest()), null),
    (error) => error.expose === true && /Could not find the table/.test(error.message),
    'supabaseRequest errors must be flagged as expose',
  );

  // The user-facing renderer shows exposed 5xx messages and masks the rest.
  const exposed = errorResponse(
    Object.assign(new Error("Supabase returned 404: Could not find the table 'public.support_requests'"), {
      expose: true,
    }),
  );
  assert.equal(exposed.statusCode, 500);
  assert.match(JSON.parse(exposed.body).error, /Could not find the table/);

  const masked = errorResponse(new Error('internal stack details'));
  assert.match(JSON.parse(masked.body).error, /could not complete that request/);
});

test('preview storage failures expose an actionable message', async (context) => {
  // Root is a FILE, so .data/ cannot be created — mimics a read-only
  // function filesystem (Netlify) running in preview mode.
  const rootFile = resolve(tmpdir(), `ddisa-readonly-${Date.now()}.txt`);
  await writeFile(rootFile, 'not a directory');
  context.after(() => rm(rootFile, { force: true }));

  const service = new SupportDeskService({ root: rootFile, env: { SUPPORT_DESK_MODE: 'preview' } });
  await assert.rejects(
    () => service.submit(normaliseSupportRequest(validRequest()), null),
    (error) =>
      error.expose === true &&
      /Preview ticket storage is unavailable/.test(error.message) &&
      /SUPPORT_DESK_MODE=production/.test(error.message),
  );
});

test('GET on the support function reports the running mode for diagnosis', async () => {
  const response = await supportRequestHandler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.mode, 'preview', 'test environment has no SUPPORT_DESK_MODE set');
  assert.equal(typeof body.supabase, 'boolean');
});
