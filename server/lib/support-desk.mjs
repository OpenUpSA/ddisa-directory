import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { bearerToken, verifySupabaseUser } from './auth.mjs';
import { cleanCountry, cleanEmail, cleanText } from './validation.mjs';

export const SUPPORT_TYPES = new Set([
  'Technical support',
  'Data',
  'Grant, payment or admin',
  'Other',
]);

export const REQUEST_GOALS = new Set([
  'Report',
  'Tool fix or build',
  'Data work',
  'Learning',
  'Other',
]);

export const ORGANISATION_TYPES = new Set([
  'CBO',
  'Women-led',
  'Youth-led',
  'LGBTIQ+',
  'Other',
]);

// Ticket workflow used by the /support-admin console (no DB check constraint;
// keep the table default 'Received' for rows created before this list).
export const TICKET_STATUSES = new Set(['Received', 'In progress', 'Forwarded', 'Closed']);

const ATTACHMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function oneOf(value, allowed, label) {
  const text = cleanText(value, { label, max: 120, required: true });
  if (!allowed.has(text)) throw new Error(`Choose a valid ${label.toLowerCase()}.`);
  return text;
}

function safeFileName(value) {
  return cleanText(value, { label: 'Attachment filename', max: 160 })
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'attachment';
}

export function cleanSupportAttachment(value) {
  if (value == null) return null;
  if (typeof value !== 'object') throw new Error('The attachment is invalid.');
  const dataUrl = typeof value.dataUrl === 'string' ? value.dataUrl : '';
  const match = dataUrl.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match || !ATTACHMENT_MIME_TYPES.has(match[1].toLowerCase())) {
    throw new Error('Upload a PDF, Word, Excel, CSV, text, JPEG, PNG or WebP file.');
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new Error('The attachment must be 25 MB or smaller.');
  }
  return {
    contentType: match[1].toLowerCase(),
    base64: match[2],
    buffer,
    filename: safeFileName(value.filename),
  };
}

export function normaliseSupportRequest(body = {}) {
  if (body.consent !== true) {
    throw new Error('Confirm that you agree to submit this support request.');
  }
  return {
    requestId:
      cleanText(body.requestId, { label: 'Request ID', max: 100 }) || randomUUID(),
    consent: true,
    fullName: cleanText(body.fullName, {
      label: 'Full name',
      max: 180,
      required: true,
    }),
    email: cleanEmail(body.email, true),
    organisation: cleanText(body.organisation, {
      label: 'Organisation',
      max: 180,
      required: true,
    }),
    country: cleanCountry(body.country),
    organisationType: oneOf(body.organisationType, ORGANISATION_TYPES, 'Organisation type'),
    organisationTypeOther:
      body.organisationType === 'Other'
        ? cleanText(body.organisationTypeOther, {
            label: 'Organisation type details',
            max: 180,
            required: true,
          })
        : '',
    supportType: oneOf(body.supportType, SUPPORT_TYPES, 'Support type'),
    supportTypeOther:
      body.supportType === 'Other'
        ? cleanText(body.supportTypeOther, {
            label: 'Support type details',
            max: 180,
            required: true,
          })
        : '',
    goal: oneOf(body.goal, REQUEST_GOALS, 'Request goal'),
    goalOther:
      body.goal === 'Other'
        ? cleanText(body.goalOther, {
            label: 'Goal details',
            max: 180,
            required: true,
          })
        : '',
    description: cleanText(body.description, {
      label: 'Request description',
      max: 600,
      required: true,
    }),
    triedSoFar: cleanText(body.triedSoFar, {
      label: 'What you have tried',
      max: 600,
    }),
    source: 'DDISA web support form',
  };
}

export function createTicketId(now = new Date(), suffix = randomBytes(3).toString('hex')) {
  const date = now.toISOString().slice(0, 10).replaceAll('-', '');
  return `DDISA-${date}-${suffix.toUpperCase()}`;
}

export function buildTrelloCard(record) {
  const organisationType = record.organisationTypeOther
    ? `${record.organisationType}: ${record.organisationTypeOther}`
    : record.organisationType;
  const supportType = record.supportTypeOther
    ? `${record.supportType}: ${record.supportTypeOther}`
    : record.supportType;
  const goal = record.goalOther ? `${record.goal}: ${record.goalOther}` : record.goal;
  return {
    name: `Support Request - ${record.organisation}`,
    desc: [
      '### Ticket information',
      `- Ticket ID: ${record.ticketId}`,
      `- Date submitted: ${record.submittedAt}`,
      '',
      '### Organisation details',
      `- Organisation: ${record.organisation}`,
      `- Contact person: ${record.fullName}`,
      `- Email: ${record.email}`,
      `- Country: ${record.country}`,
      `- Organisation type: ${organisationType}`,
      '',
      '### Request',
      `- Support type: ${supportType}`,
      `- Goal: ${goal}`,
      '',
      '### Request description',
      record.description,
      '',
      '### Tried so far',
      record.triedSoFar || 'Not provided',
      '',
      '### Source',
      record.source,
    ].join('\n'),
  };
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

export function buildConfirmationEmail(record) {
  const firstName = record.fullName.trim().split(/\s+/)[0];
  const subject = `[${record.ticketId}] We received your DDISA support request`;
  const text = [
    `Dear ${firstName},`,
    '',
    'Thank you for contacting the Digital Democracy Innovation in Sub-Saharan Africa (DDISA) Support Desk.',
    '',
    'We have successfully received and logged your support request.',
    '',
    'Ticket details',
    `Reference number: ${record.ticketId}`,
    `Organisation: ${record.organisation}`,
    `Support type: ${record.supportType}`,
    `Date submitted: ${record.submittedAt}`,
    '',
    'Summary of request:',
    record.description,
    '',
    'What happens next?',
    'A member of the DDISA team will review your request and respond as soon as possible.',
    'A team member may contact you if additional information is required.',
    'Please keep this email and quote the ticket number in future correspondence.',
    '',
    'Kind regards,',
    'DDISA Support Team',
    'Digital Democracy Innovation in Sub-Saharan Africa Fund',
  ].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;color:#061329;line-height:1.6;max-width:640px">
    <h2 style="margin:0 0 20px">DDISA Support Desk</h2>
    <p>Dear ${escapeHtml(firstName)},</p>
    <p>Thank you for contacting the Digital Democracy Innovation in Sub-Saharan Africa (DDISA) Support Desk. We have received and logged your request.</p>
    <h3>Ticket details</h3>
    <table style="border-collapse:collapse">
      <tr><td style="padding:4px 14px 4px 0;color:#57667a">Reference number</td><td><strong>${escapeHtml(record.ticketId)}</strong></td></tr>
      <tr><td style="padding:4px 14px 4px 0;color:#57667a">Organisation</td><td>${escapeHtml(record.organisation)}</td></tr>
      <tr><td style="padding:4px 14px 4px 0;color:#57667a">Support type</td><td>${escapeHtml(record.supportType)}</td></tr>
      <tr><td style="padding:4px 14px 4px 0;color:#57667a">Date submitted</td><td>${escapeHtml(record.submittedAt)}</td></tr>
    </table>
    <h3>Summary of request</h3>
    <p style="white-space:pre-wrap">${escapeHtml(record.description)}</p>
    <h3>What happens next</h3>
    <p>A member of the DDISA team will review your request and respond as soon as possible. We may contact you if additional information is required.</p>
    <p>Please keep this email and quote the ticket number in future correspondence.</p>
    <p>Kind regards,<br>DDISA Support Team<br>Digital Democracy Innovation in Sub-Saharan Africa Fund</p>
  </div>`;
  return { subject, text, html };
}

export function buildSlackMessage(record, trelloUrl = '') {
  return [
    `New support ticket received: ${record.organisation}`,
    `Ticket: ${record.ticketId}`,
    `Support type: ${record.supportType}`,
    `Goal: ${record.goal}`,
    `Request: ${record.description}`,
    trelloUrl
      ? `Trello: ${trelloUrl}`
      : record.integrations?.trello?.status === 'sent'
        ? 'Trello: forwarded to the board by email.'
        : 'Trello: not forwarded.',
  ].join('\n');
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJsonAtomic(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}

export class SupportDeskService {
  constructor({ root, env = process.env, fetchImpl = globalThis.fetch, now = () => new Date() }) {
    this.env = env;
    this.fetch = fetchImpl;
    this.now = now;
    this.mode = env.SUPPORT_DESK_MODE === 'production' ? 'production' : 'preview';
    this.dataFile = resolve(root, '.data', 'support-requests.json');
    this.attachmentDir = resolve(root, '.data', 'support-attachments');
    this.supabaseUrl = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
    this.supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
    this.supabaseTable = env.SUPABASE_SUPPORT_TABLE || 'support_requests';
    this.supabaseBucket = env.SUPABASE_SUPPORT_BUCKET || 'support-attachments';

    if (this.mode === 'production') {
      // Only Supabase is a hard requirement. Email runs through the
      // `support-confirmation` Edge Function (Brevo secrets live in Supabase);
      // Trello and Slack are optional and report "not configured" in the
      // ticket's integrations until their variables are set.
      const required = [
        'SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
      ];
      const missing = required.filter((key) => !env[key] || String(env[key]).startsWith('replace-'));
      if (missing.length) {
        const error = new Error(`Missing support desk configuration: ${missing.join(', ')}`);
        error.expose = true; // actionable config problem — safe to show in the UI
        throw error;
      }
    }
  }

  createRecord(payload) {
    const submitted = this.now();
    return {
      ...payload,
      ticketId: createTicketId(submitted),
      submittedAt: submitted.toISOString(),
      status: 'Received',
      attachment: null,
      trelloCardId: '',
      trelloCardUrl: '',
      integrations: {},
    };
  }

  async submit(payload, attachment) {
    const record = this.createRecord(payload);
    if (this.mode === 'preview') {
      return this.submitPreview(record, attachment);
    }
    return this.submitProduction(record, attachment);
  }

  async submitPreview(record, attachment) {
    let rows;
    try {
      rows = await readJson(this.dataFile, []);
    } catch (error) {
      // ENOTDIR/EROFS etc. when .data/ cannot exist (read-only filesystem).
      throw this.previewStorageError(error);
    }
    const existing = rows.find((row) => row.requestId === record.requestId);
    if (existing) return this.publicResult(existing, { preview: true });

    if (attachment) {
      try {
        await mkdir(this.attachmentDir, { recursive: true });
        const storedName = `${record.ticketId}-${attachment.filename}`;
        await writeFile(resolve(this.attachmentDir, storedName), attachment.buffer);
        record.attachment = {
          filename: attachment.filename,
          contentType: attachment.contentType,
          storagePath: `.data/support-attachments/${storedName}`,
        };
      } catch (error) {
        throw this.previewStorageError(error);
      }
    }
    record.integrations = {
      trello: 'not configured in preview',
      email: 'not configured in preview',
      slack: 'not configured in preview',
    };
    rows.push(record);
    try {
      await writeJsonAtomic(this.dataFile, rows);
    } catch (error) {
      throw this.previewStorageError(error);
    }
    return this.publicResult(record, { preview: true });
  }

  /**
   * Preview mode writes .data/ under the working directory — fine locally,
   * but on Netlify the function filesystem is read-only. Turn that EACCES/
   * EROFS/ENOTDIR into a message that says exactly what to do instead of a
   * masked 500.
   */
  previewStorageError(error) {
    const wrapped = new Error(
      `Preview ticket storage is unavailable (${error.code || error.message}). ` +
        'Preview mode writes .data/ on the local machine only - set SUPPORT_DESK_MODE=production in this environment.',
    );
    wrapped.expose = true;
    return wrapped;
  }

  async submitProduction(record, attachment) {
    const existing = await this.supabaseRequest(
      `/rest/v1/${this.supabaseTable}?request_id=eq.${encodeURIComponent(record.requestId)}&select=*`,
    );
    if (Array.isArray(existing) && existing.length) {
      return this.publicResult(this.fromSupabase(existing[0]));
    }

    await this.insertSupabaseRecord(record);
    if (attachment) {
      const path = `${record.ticketId}/${attachment.filename}`;
      try {
        await this.uploadAttachment(path, attachment);
        record.attachment = {
          filename: attachment.filename,
          contentType: attachment.contentType,
          storagePath: path,
        };
      } catch (error) {
        record.integrations.attachment = { status: 'failed', error: error.message };
      }
    }

    const trello = await this.forwardCardToTrello(record);
    record.integrations.trello = trello;
    record.trelloCardId = trello.cardId || '';
    record.trelloCardUrl = trello.url || '';

    const [email, slack] = await Promise.all([
      this.sendConfirmationEmail(record),
      this.sendSlackNotification(record),
    ]);
    record.integrations.email = email;
    record.integrations.slack = slack;
    await this.updateSupabaseRecord(record);
    return this.publicResult(record);
  }

  publicResult(record, { preview = false } = {}) {
    return {
      ticketId: record.ticketId,
      submittedAt: record.submittedAt,
      supportType: record.supportType,
      preview,
      integrations: {
        trello: record.integrations?.trello || 'not configured',
        email: record.integrations?.email || 'not configured',
        slack: record.integrations?.slack || 'not configured',
      },
    };
  }

  async supabaseRequest(path, options = {}) {
    const response = await this.fetch(`${this.supabaseUrl}${path}`, {
      ...options,
      headers: {
        apikey: this.supabaseKey,
        Authorization: `Bearer ${this.supabaseKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`Supabase returned ${response.status}: ${text.slice(0, 200)}`);
      // Actionable dependency failure (missing table, RLS, bad env) — expose
      // it instead of the generic masked 500 so the form explains itself.
      error.expose = true;
      throw error;
    }
    return text ? JSON.parse(text) : null;
  }

  supabaseFields(record) {
    return {
      request_id: record.requestId,
      ticket_id: record.ticketId,
      submitted_at: record.submittedAt,
      full_name: record.fullName,
      email: record.email,
      organisation: record.organisation,
      country: record.country,
      organisation_type: record.organisationType,
      organisation_type_other: record.organisationTypeOther,
      support_type: record.supportType,
      support_type_other: record.supportTypeOther,
      goal: record.goal,
      goal_other: record.goalOther,
      description: record.description,
      tried_so_far: record.triedSoFar,
      attachment_path: record.attachment?.storagePath || '',
      attachment_name: record.attachment?.filename || '',
      source: record.source,
      status: record.status,
      trello_card_id: record.trelloCardId,
      trello_card_url: record.trelloCardUrl,
      integrations: record.integrations,
    };
  }

  fromSupabase(row) {
    return {
      requestId: row.request_id,
      ticketId: row.ticket_id,
      submittedAt: row.submitted_at,
      fullName: row.full_name,
      email: row.email,
      organisation: row.organisation,
      country: row.country,
      organisationType: row.organisation_type,
      organisationTypeOther: row.organisation_type_other || '',
      supportType: row.support_type,
      supportTypeOther: row.support_type_other || '',
      goal: row.goal,
      goalOther: row.goal_other || '',
      description: row.description,
      triedSoFar: row.tried_so_far || '',
      source: row.source,
      status: row.status,
      trelloCardId: row.trello_card_id || '',
      trelloCardUrl: row.trello_card_url || '',
      attachment: row.attachment_path
        ? { filename: row.attachment_name, storagePath: row.attachment_path }
        : null,
      integrations: row.integrations || {},
    };
  }

  async insertSupabaseRecord(record) {
    await this.supabaseRequest(`/rest/v1/${this.supabaseTable}`, {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(this.supabaseFields(record)),
    });
  }

  async updateSupabaseRecord(record) {
    await this.supabaseRequest(
      `/rest/v1/${this.supabaseTable}?ticket_id=eq.${encodeURIComponent(record.ticketId)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(this.supabaseFields(record)),
      },
    );
  }

  async uploadAttachment(path, attachment) {
    const response = await this.fetch(
      `${this.supabaseUrl}/storage/v1/object/${this.supabaseBucket}/${path.split('/').map(encodeURIComponent).join('/')}`,
      {
        method: 'POST',
        headers: {
          apikey: this.supabaseKey,
          Authorization: `Bearer ${this.supabaseKey}`,
          'Content-Type': attachment.contentType,
          'x-upsert': 'false',
        },
        body: attachment.buffer,
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Supabase storage returned ${response.status}.`);
    }
  }

  /**
   * Forward the ticket to Trello by EMAIL — no API keys needed. Trello's
   * "Upload by email" feature turns the subject into the card title and the
   * body into its description, so buildTrelloCard's {name, desc} maps
   * straight onto an email through the `support-confirmation` relay (Brevo).
   * The board address comes from TRELLO_BOARD_EMAIL (Board → … → Upload by
   * email); without it forwarding reports "not configured".
   */
  async forwardCardToTrello(record) {
    const boardEmail = this.env.TRELLO_BOARD_EMAIL;
    if (!boardEmail) return { status: 'not configured' };
    const card = buildTrelloCard(record);
    try {
      const response = await this.fetch(`${this.supabaseUrl}/functions/v1/support-confirmation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.supabaseKey}`,
          apikey: this.supabaseKey,
        },
        body: JSON.stringify({
          to: boardEmail,
          subject: card.name,
          text: card.desc,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || `Email function returned ${response.status}.`);
      }
      return { status: 'sent', messageId: body.messageId || '' };
    } catch (error) {
      return { status: 'failed', error: error.message };
    }
  }

  async sendConfirmationEmail(record) {
    const email = buildConfirmationEmail(record);
    try {
      // Confirmation email goes through the `support-confirmation` Supabase
      // Edge Function (Brevo relay — script in
      // supabase/functions/support-confirmation/index.ts). Authenticated with
      // the service-role key; the function keeps JWT verification ON.
      const response = await this.fetch(
        `${this.supabaseUrl}/functions/v1/support-confirmation`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.supabaseKey}`,
            apikey: this.supabaseKey,
          },
          body: JSON.stringify({
            to: record.email,
            subject: email.subject,
            text: email.text,
            html: email.html,
          }),
          signal: AbortSignal.timeout(20_000),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || `Support email function returned ${response.status}.`);
      }
      return { status: 'sent', messageId: body.messageId || '' };
    } catch (error) {
      return { status: 'failed', error: error.message };
    }
  }

  async sendSlackNotification(record) {
    if (!this.env.SLACK_SUPPORT_WEBHOOK_URL) {
      return { status: 'not configured' };
    }
    try {
      const response = await this.fetch(this.env.SLACK_SUPPORT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: buildSlackMessage(record, record.trelloCardUrl),
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`Slack returned ${response.status}.`);
      return { status: 'sent' };
    } catch (error) {
      return { status: 'failed', error: error.message };
    }
  }

  status() {
    return {
      mode: this.mode,
      supabase: Boolean(this.supabaseUrl && this.supabaseKey),
      // Confirmations and Trello board forwards both run through the
      // `support-confirmation` Edge Function (Brevo). This reports whether
      // the board address is configured; the per-ticket integrations JSON is
      // the ground truth for what actually happened.
      trello: Boolean(this.env.TRELLO_BOARD_EMAIL),
      email: Boolean(this.supabaseUrl && this.supabaseKey),
      slack: Boolean(this.env.SLACK_SUPPORT_WEBHOOK_URL),
    };
  }

  // ------------------------------------------------------------ admin API --

  /**
   * Verify the caller's Supabase Auth session (same passwordless flow the
   * grantee sign-in uses) AND membership of public.support_admins.
   * Throws 401 (no/expired session) or 403 (not an admin).
   */
  async verifyAdmin(authorization) {
    if (!this.supabaseUrl || !this.supabaseKey) {
      const error = httpError(501, 'The support admin API requires Supabase configuration.');
      error.expose = true;
      throw error;
    }
    const accessToken = bearerToken(authorization);
    if (!accessToken) throw httpError(401, 'Sign in to manage the support desk.');
    const user = await verifySupabaseUser({
      baseUrl: this.supabaseUrl,
      apiKey: this.supabaseKey,
      accessToken,
      fetchImpl: this.fetch,
    });
    if (!user) throw httpError(401, 'Your session has expired. Please sign in again.');
    const rows = await this.supabaseRequest(
      `/rest/v1/support_admins?user_id=eq.${encodeURIComponent(user.id)}&select=user_id,email`,
    );
    if (!rows?.length) {
      throw httpError(403, 'Your account does not have support-desk admin access.');
    }
    return { id: user.id, email: rows[0].email || user.email };
  }

  async listTickets() {
    const rows = await this.supabaseRequest(
      `/rest/v1/${this.supabaseTable}?select=*&order=submitted_at.desc`,
    );
    return (rows || []).map((row) => this.fromSupabase(row));
  }

  async getTicket(ticketId) {
    const rows = await this.supabaseRequest(
      `/rest/v1/${this.supabaseTable}?ticket_id=eq.${encodeURIComponent(ticketId)}&select=*`,
    );
    if (!rows?.length) throw httpError(404, 'That support ticket could not be found.');
    return this.fromSupabase(rows[0]);
  }

  async setTicketStatus(ticketId, status) {
    if (!TICKET_STATUSES.has(status)) {
      throw httpError(400, `Status must be one of: ${[...TICKET_STATUSES].join(', ')}.`);
    }
    const rows = await this.supabaseRequest(
      `/rest/v1/${this.supabaseTable}?ticket_id=eq.${encodeURIComponent(ticketId)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ status }),
      },
    );
    if (!rows?.length) throw httpError(404, 'That support ticket could not be found.');
    return { ticketId, status };
  }

  /**
   * Forward a ticket to the Trello board by email through the
   * support-confirmation Edge Function. Idempotent: the outcome is stored in
   * the ticket's integrations JSON (email forwards have no card URL).
   */
  async forwardTicketToTrello(ticketId) {
    const ticket = await this.getTicket(ticketId);
    const previous = ticket.integrations?.trello;
    if (ticket.trelloCardUrl || (previous && ['sent', 'created'].includes(previous.status))) {
      return { ticketId, alreadyForwarded: true, url: ticket.trelloCardUrl || '' };
    }
    const outcome = await this.forwardCardToTrello(ticket);
    if (outcome.status !== 'sent') {
      const error = new Error(outcome.error || 'The ticket could not be forwarded to Trello.');
      error.expose = true;
      throw error;
    }
    await this.supabaseRequest(
      `/rest/v1/${this.supabaseTable}?ticket_id=eq.${encodeURIComponent(ticketId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          integrations: { ...(ticket.integrations || {}), trello: outcome },
        }),
      },
    );
    return { ticketId, alreadyForwarded: false, url: '' };
  }

  /** Short-lived signed URL for a ticket attachment (private bucket). */
  async signAttachment(ticketId) {
    const ticket = await this.getTicket(ticketId);
    const path = ticket.attachment?.storagePath;
    if (!path) throw httpError(404, 'This ticket has no attachment.');
    const result = await this.supabaseRequest(
      `/storage/v1/object/sign/${this.supabaseBucket}/${path.split('/').map(encodeURIComponent).join('/')}`,
      { method: 'POST', body: JSON.stringify({ expiresIn: 3600 }) },
    );
    const signed = String(result?.signedURL || '');
    if (!signed) {
      const error = httpError(502, 'The attachment link could not be created.');
      error.expose = true;
      throw error;
    }
    return {
      url: signed.startsWith('http') ? signed : `${this.supabaseUrl}/storage/v1${signed}`,
      expiresIn: 3600,
    };
  }

  // ------------------------------------------- organisation login emails --

  /**
   * Find the Supabase Auth user for a login email, creating it if missing
   * (passwordless — GoTrue admin API with the service-role key; the account
   * is auto-confirmed because the OTP email itself proves mailbox control).
   */
  async findOrCreateAuthUser(rawEmail) {
    const email = cleanEmail(rawEmail, true);
    const found = await this.supabaseRequest(
      `/auth/v1/admin/users?filter=${encodeURIComponent(email)}&per_page=10`,
    );
    const users = Array.isArray(found) ? found : found?.users || [];
    const existing = users.find(
      (row) => String(row.email || '').toLowerCase() === email.toLowerCase(),
    );
    if (existing) return { id: existing.id, email, created: false };

    const created = await this.supabaseRequest('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, email_confirm: true }),
    });
    if (!created?.id) {
      const error = httpError(502, 'The login account could not be created in Supabase Auth.');
      error.expose = true;
      throw error;
    }
    return { id: created.id, email, created: true };
  }

  /**
   * Link (or replace) an organisation's login email: ensures the Supabase
   * Auth user exists and points organisations.owner_id / owner_email at it.
   * That person then edits the profile with the directory's passwordless
   * sign-in; support admins can edit every organisation regardless.
   */
  async linkOrganisationOwner(organisationSlug, rawEmail) {
    const slug = String(organisationSlug || '').trim();
    const email = cleanEmail(rawEmail, true);
    const rows = await this.supabaseRequest(
      `/rest/v1/organisations?slug=eq.${encodeURIComponent(slug)}&select=slug,name`,
    );
    if (!rows?.length) throw httpError(404, 'That organisation could not be found.');

    const user = await this.findOrCreateAuthUser(email);
    const updated = await this.supabaseRequest(
      `/rest/v1/organisations?slug=eq.${encodeURIComponent(slug)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ owner_id: user.id, owner_email: email }),
      },
    );
    if (!updated?.length) throw httpError(404, 'That organisation could not be found.');
    return {
      organisationSlug: slug,
      organisationName: rows[0].name,
      email,
      userId: user.id,
      userCreated: user.created,
    };
  }

  async unlinkOrganisationOwner(organisationSlug) {
    const slug = String(organisationSlug || '').trim();
    const updated = await this.supabaseRequest(
      `/rest/v1/organisations?slug=eq.${encodeURIComponent(slug)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ owner_id: null, owner_email: null }),
      },
    );
    if (!updated?.length) throw httpError(404, 'That organisation could not be found.');
    return { organisationSlug: slug, unlinked: true };
  }

  /** Organisations with their login email, for the admin console. */
  async listOrganisationsForAdmin() {
    const rows = await this.supabaseRequest(
      '/rest/v1/organisations?select=slug,name,owner_email&order=name.asc',
    );
    return (rows || []).map((row) => ({
      slug: row.slug,
      name: row.name,
      ownerEmail: row.owner_email || '',
    }));
  }
}
