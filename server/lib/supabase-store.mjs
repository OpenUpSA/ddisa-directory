import { randomUUID } from 'node:crypto';
import { slugify } from './validation.mjs';

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

  /**
   * Replace the child rows of an organisation with the validated submission
   * payload (types, offerings, contacts, resources).
   */
  async replaceChildren(organisationId, payload) {
    const typeRows = (payload.type || []).map((csoType) => ({
      organisation_id: organisationId,
      cso_type: csoType,
    }));
    const offeringRows = [
      ...(payload.offerings?.tools || []).map((item, index) => ({
        organisation_id: organisationId,
        kind: 'tool',
        name: item.name,
        description: item.description || '',
        sort_order: index,
      })),
      ...(payload.offerings?.services || []).map((item, index) => ({
        organisation_id: organisationId,
        kind: 'service',
        name: item.name,
        description: item.description || '',
        sort_order: index,
      })),
    ];
    const contactRows = (payload.contacts || []).map((contact, index) => ({
      organisation_id: organisationId,
      type: contact.type,
      name: contact.name,
      email: contact.email || '',
      number: contact.number || '',
      url: contact.url || '',
      role: contact.role || '',
      description: contact.description || '',
      sort_order: index,
    }));
    const resourceRows = (payload.resources || []).map((resource, index) => ({
      organisation_id: organisationId,
      title: resource.title,
      url: resource.url,
      description: resource.description || '',
      sort_order: index,
    }));

    for (const table of ['organisation_types', 'offerings', 'contacts', 'resources']) {
      await this.rest(table, {
        method: 'DELETE',
        query: { organisation_id: `eq.${organisationId}` },
      });
    }
    if (typeRows.length) {
      await this.rest('organisation_types', { method: 'POST', body: typeRows });
    }
    if (offeringRows.length) {
      await this.rest('offerings', { method: 'POST', body: offeringRows });
    }
    if (contactRows.length) {
      await this.rest('contacts', { method: 'POST', body: contactRows });
    }
    if (resourceRows.length) {
      await this.rest('resources', { method: 'POST', body: resourceRows });
    }
  }

  /** Best-effort audit row — failures are logged, never block publishing. */
  async auditSubmission(payload, { organisationSlug, photoPath = '', logoPath = '' }) {
    try {
      await this.rest('submissions', {
        method: 'POST',
        body: {
          id: randomUUID(),
          request_type: payload.requestType || 'Profile update',
          organisation_slug: organisationSlug,
          organisation_name: payload.organisationName || payload.name || '',
          payload,
          photo_path: photoPath,
          logo_path: logoPath,
          review_status: 'Approved',
          submitted_at: new Date().toISOString(),
          reviewed_at: new Date().toISOString(),
          internal_notes: 'Published automatically after server-side validation.',
        },
      });
    } catch (error) {
      console.error('Audit row could not be written:', error.message);
    }
  }

  /**
   * Direct publication of a profile update (signed edit link already verified
   * by the caller). Uploads images to the public buckets at stable slug paths,
   * updates the organisation row, then replaces its child rows.
   */
  async publishProfileUpdate(organisationId, payload, photo, logo) {
    const rows = await this.rest('organisations', {
      query: {
        select: 'id,slug,name,photo_path,logo_path',
        slug: `eq.${organisationId}`,
        limit: 1,
      },
    });
    const organisation = rows[0];
    if (!organisation) {
      const error = new Error('The organisation could not be found.');
      error.status = 404;
      throw error;
    }
    const slug = organisation.slug;

    let photoPath = organisation.photo_path || '';
    if (photo) {
      const extension = imageExtension(photo.contentType);
      photoPath = `organisation-photos/profiles/${slug}.${extension}`;
      await this.uploadObject(this.buckets.photos, `profiles/${slug}.${extension}`, photo);
    }
    let logoPath = organisation.logo_path || '';
    if (logo) {
      const extension = imageExtension(logo.contentType);
      logoPath = `organisation-logos/logos/${slug}.${extension}`;
      await this.uploadObject(this.buckets.logos, `logos/${slug}.${extension}`, logo);
    }

    await this.rest('organisations', {
      method: 'PATCH',
      query: { slug: `eq.${slug}` },
      body: {
        summary: payload.summary,
        description: payload.description,
        collaboration: payload.collaboration || '',
        public_email: payload.publicEmail || payload.contactEmail || null,
        photo_alt: payload.photoAlt || '',
        photo_path: photoPath,
        logo_path: logoPath,
      },
    });

    await this.replaceChildren(organisation.id, payload);
    await this.auditSubmission(payload, {
      organisationSlug: slug,
      photoPath,
      logoPath,
    });
    return { id: slug, table: 'organisations' };
  }

  /**
   * Direct publication of a new organisation. Rejects duplicates (slug or
   * case-insensitive name) with 409, then inserts org → children → publish.
   */
  async publishNewOrganisation(payload, photo, logo) {
    const slug = slugify(payload.name);
    const wanted = String(payload.name).trim().toLowerCase();
    const existing = await this.rest('organisations', { query: { select: 'slug,name' } });
    if (
      existing.some(
        (row) => row.slug === slug || String(row.name || '').trim().toLowerCase() === wanted,
      )
    ) {
      const error = new Error('An organisation with this name is already in the directory.');
      error.status = 409;
      throw error;
    }

    let logoPath = '';
    if (logo) {
      const extension = imageExtension(logo.contentType);
      logoPath = `organisation-logos/logos/${slug}.${extension}`;
      await this.uploadObject(this.buckets.logos, `logos/${slug}.${extension}`, logo);
    }
    let photoPath = '';
    if (photo) {
      const extension = imageExtension(photo.contentType);
      photoPath = `organisation-photos/profiles/${slug}.${extension}`;
      await this.uploadObject(this.buckets.photos, `profiles/${slug}.${extension}`, photo);
    }

    const created = await this.rest('organisations', {
      method: 'POST',
      body: {
        slug,
        name: payload.name,
        country: payload.country,
        region: payload.region,
        summary: payload.summary,
        description: payload.description,
        collaboration: payload.collaboration || '',
        public_email: payload.publicEmail || payload.contactEmail || null,
        focus_areas: [],
        matched: true,
        logo_path: logoPath,
        photo_path: photoPath,
        photo_alt: payload.photoAlt || '',
        publication_status: 'published',
      },
    });
    const row = Array.isArray(created) ? created[0] : null;
    if (!row?.id) {
      const error = new Error('The organisation could not be created.');
      error.status = 502;
      throw error;
    }

    if (payload.website) {
      await this.rest('social_links', {
        method: 'POST',
        body: [{ organisation_id: row.id, platform: 'website', url: payload.website, sort_order: 0 }],
      });
    }

    await this.replaceChildren(row.id, payload);
    await this.auditSubmission(payload, {
      organisationSlug: slug,
      photoPath,
      logoPath,
    });
    return { id: slug, table: 'organisations' };
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
        consent_shared: payload.consentShared === true,
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
