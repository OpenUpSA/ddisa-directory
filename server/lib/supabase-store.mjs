import { randomUUID } from 'node:crypto';

const DEFAULT_BUCKETS = {
  logos: 'organisation-logos',
  photos: 'organisation-photos',
  submissions: 'submission-uploads',
};

function publicUrl(baseUrl, path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  const slash = path.indexOf('/');
  if (slash < 1) return '';
  const bucket = path.slice(0, slash);
  const objectPath = path.slice(slash + 1);
  return `${baseUrl}/storage/v1/object/public/${bucket}/${objectPath}`;
}

function imageExtension(contentType) {
  return String(contentType || '').split('/')[1] || 'webp';
}

function isPublished(row) {
  return row.publication_status !== 'draft' && row.publication_status !== 'archived';
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Supabase (PostgREST + Storage) adapter for the directory reference server.
 *
 * Uses the service-role key server-side only. RLS keeps the anon key
 * read-only for published rows; writes always travel through the server.
 */
export class SupabaseStore {
  constructor({ baseUrl, serviceRoleKey, buckets = {} }) {
    if (!baseUrl) throw new Error('SUPABASE_URL is required.');
    if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required.');

    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.serviceRoleKey = serviceRoleKey;
    this.restUrl = `${this.baseUrl}/rest/v1`;
    this.storageUrl = `${this.baseUrl}/storage/v1`;
    this.buckets = { ...DEFAULT_BUCKETS, ...buckets };
  }

  headers(extra = {}) {
    return {
      apikey: this.serviceRoleKey,
      Authorization: `Bearer ${this.serviceRoleKey}`,
      Accept: 'application/json',
      ...extra,
    };
  }

  async rest(path, { method = 'GET', query = {}, body, signal } = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
    }
    const suffix = search.size ? `?${search.toString()}` : '';

    const response = await fetch(`${this.restUrl}/${path}${suffix}`, {
      method,
      headers: this.headers({
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method === 'GET' ? {} : { Prefer: 'return=representation' }),
      }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: signal || AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase returned ${response.status}: ${detail.slice(0, 300)}`);
    }
    if (response.status === 204) return null;

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async uploadObject(bucket, objectPath, image) {
    const response = await fetch(`${this.storageUrl}/object/${bucket}/${objectPath}`, {
      method: 'POST',
      headers: this.headers({
        'Content-Type': image.contentType,
        'Cache-Control': 'max-age=31536000',
        'x-upsert': 'true',
      }),
      body: image.buffer,
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase storage returned ${response.status}: ${detail.slice(0, 300)}`);
    }
  }

  organisationSelect() {
    return [
      'slug',
      'name',
      'country',
      'region',
      'cohort',
      'summary',
      'description',
      'collaboration',
      'public_email',
      'focus_areas',
      'matched',
      'logo_path',
      'photo_path',
      'photo_alt',
      'logo_background',
      'last_reviewed',
      'publication_status',
      'organisation_types(cso_type)',
      'offerings(kind,name,description,category,sort_order,publication_status)',
      'contacts(type,name,email,number,url,role,description,sort_order,publication_status)',
      'resources(title,url,description,sort_order,publication_status)',
      'social_links(platform,url,sort_order)',
    ].join(',');
  }

  mapOrganisation(row) {
    const types = asList(row.organisation_types).map((item) => item.cso_type);
    const offerings = asList(row.offerings).filter(isPublished);
    const contacts = asList(row.contacts)
      .filter(isPublished)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
    const resources = asList(row.resources).filter(isPublished);
    const social = asList(row.social_links).sort(
      (a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0),
    );

    return {
      id: row.slug,
      slug: row.slug,
      name: row.name,
      country: row.country,
      region: row.region,
      focus: asList(row.focus_areas),
      type: types,
      cohort: row.cohort || 'Cohort 1',
      description: row.description || '',
      collaboration:
        row.collaboration || 'Collaboration interests have not yet been confirmed.',
      publicEmail: row.public_email || '',
      matched: Boolean(row.matched),
      social: social.map((link) => ({ type: link.platform, url: link.url })),
      offerings: {
        tools: offerings
          .filter((item) => item.kind === 'tool')
          .map((item) => ({
            name: item.name,
            description: item.description,
            category: item.category || '',
          })),
        services: offerings
          .filter((item) => item.kind === 'service')
          .map((item) => ({
            name: item.name,
            description: item.description,
            category: item.category || '',
          })),
      },
      resources: resources.map((resource) => ({
        title: resource.title,
        url: resource.url,
        description: resource.description || '',
      })),
      contacts: contacts.map((contact) => ({
        type: contact.type,
        name: contact.name,
        email: contact.email || '',
        number: contact.number || '',
        url: contact.url || '',
        role: contact.role || '',
        description: contact.description || '',
      })),
      logo: publicUrl(this.baseUrl, row.logo_path),
      photo: publicUrl(this.baseUrl, row.photo_path),
      photoAlt: row.photo_alt || '',
      logoBackground: row.logo_background || '',
      summary: row.summary || '',
      lastReviewed: row.last_reviewed || null,
      source: 'supabase',
    };
  }

  async listDirectory() {
    const rows = await this.rest('organisations', {
      query: { select: this.organisationSelect(), order: 'name.asc' },
    });
    return rows.filter(isPublished).map((row) => this.mapOrganisation(row));
  }

  async findOrganisation(organisationId) {
    const rows = await this.rest('organisations', {
      query: {
        select: 'slug,name,publication_status,token_version',
        slug: `eq.${organisationId}`,
        limit: 1,
      },
    });
    return rows[0] || null;
  }

  async createSubmission(payload, photo, logo) {
    const id = randomUUID();
    const uploads = [];
    let photoPath = '';
    let logoPath = '';

    if (photo) {
      photoPath = `${this.buckets.submissions}/${id}/photo.${imageExtension(photo.contentType)}`;
      uploads.push([photoPath, photo]);
    }
    if (logo) {
      logoPath = `${this.buckets.submissions}/${id}/logo.${imageExtension(logo.contentType)}`;
      uploads.push([logoPath, logo]);
    }

    for (const [path, image] of uploads) {
      const slash = path.indexOf('/');
      await this.uploadObject(path.slice(0, slash), path.slice(slash + 1), image);
    }

    await this.rest('submissions', {
      method: 'POST',
      body: {
        id,
        request_type: payload.requestType,
        organisation_slug: payload.organisationId || null,
        organisation_name: payload.organisationName,
        payload,
        photo_path: photoPath,
        logo_path: logoPath,
        review_status: 'Pending',
        submitted_at: new Date().toISOString(),
      },
    });

    return { id, table: 'submissions' };
  }

  async createCollaborationRequest(payload) {
    const rows = await this.rest('collaboration_requests', {
      method: 'POST',
      body: {
        recipient_organisation: payload.recipientOrganisation,
        sender_organisation: payload.senderOrganisation,
        sender_name: payload.senderName,
        sender_email: payload.senderEmail,
        collaboration_type: payload.collaborationType,
        message: payload.message,
        status: 'New',
      },
    });
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  async health() {
    await this.rest('organisations', { query: { select: 'slug', limit: 1 } });
    return { database: 'supabase', connected: true };
  }
}
