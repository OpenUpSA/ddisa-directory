import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
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
    trelloUrl ? `Trello: ${trelloUrl}` : 'Trello card could not be linked.',
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
      const required = [
        'SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
        'TRELLO_KEY',
        'TRELLO_TOKEN',
        'TRELLO_LIST_ID',
        'RESEND_API_KEY',
        'SUPPORT_EMAIL_FROM',
        'SLACK_SUPPORT_WEBHOOK_URL',
      ];
      const missing = required.filter((key) => !env[key] || String(env[key]).startsWith('replace-'));
      if (missing.length) throw new Error(`Missing support desk configuration: ${missing.join(', ')}`);
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
    const rows = await readJson(this.dataFile, []);
    const existing = rows.find((row) => row.requestId === record.requestId);
    if (existing) return this.publicResult(existing, { preview: true });

    if (attachment) {
      await mkdir(this.attachmentDir, { recursive: true });
      const storedName = `${record.ticketId}-${attachment.filename}`;
      await writeFile(resolve(this.attachmentDir, storedName), attachment.buffer);
      record.attachment = {
        filename: attachment.filename,
        contentType: attachment.contentType,
        storagePath: `.data/support-attachments/${storedName}`,
      };
    }
    record.integrations = {
      trello: 'not configured in preview',
      email: 'not configured in preview',
      slack: 'not configured in preview',
    };
    rows.push(record);
    await writeJsonAtomic(this.dataFile, rows);
    return this.publicResult(record, { preview: true });
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

    const trello = await this.createTrelloCard(record);
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
    if (!response.ok) throw new Error(`Supabase returned ${response.status}: ${text.slice(0, 200)}`);
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

  async createTrelloCard(record) {
    const card = buildTrelloCard(record);
    const params = new URLSearchParams({
      key: this.env.TRELLO_KEY,
      token: this.env.TRELLO_TOKEN,
      idList: this.env.TRELLO_LIST_ID,
      name: card.name,
      desc: card.desc,
    });
    try {
      const response = await this.fetch(`https://api.trello.com/1/cards?${params}`, {
        method: 'POST',
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || `Trello returned ${response.status}.`);
      return { status: 'created', cardId: body.id || '', url: body.shortUrl || body.url || '' };
    } catch (error) {
      return { status: 'failed', error: error.message };
    }
  }

  async sendConfirmationEmail(record) {
    const email = buildConfirmationEmail(record);
    try {
      const response = await this.fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.env.SUPPORT_EMAIL_FROM,
          to: [record.email],
          reply_to: this.env.SUPPORT_EMAIL_REPLY_TO || this.env.SUPPORT_EMAIL_FROM,
          subject: email.subject,
          text: email.text,
          html: email.html,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || `Email service returned ${response.status}.`);
      return { status: 'sent', messageId: body.id || '' };
    } catch (error) {
      return { status: 'failed', error: error.message };
    }
  }

  async sendSlackNotification(record) {
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
      trello: Boolean(this.env.TRELLO_KEY && this.env.TRELLO_TOKEN && this.env.TRELLO_LIST_ID),
      email: Boolean(this.env.RESEND_API_KEY && this.env.SUPPORT_EMAIL_FROM),
      slack: Boolean(this.env.SLACK_SUPPORT_WEBHOOK_URL),
    };
  }
}
