import assert from 'node:assert/strict';
import test from 'node:test';
import { SupabaseStore } from '../server/lib/supabase-store.mjs';

const BASE_URL = 'https://example.supabase.co';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function publishedOrganisation(overrides = {}) {
  return {
    slug: 'example-organisation',
    name: 'Example Organisation',
    country: 'Kenya',
    region: 'Eastern Africa',
    cohort: 'Cohort 1',
    summary: 'A short introduction.',
    description: 'A full description.',
    collaboration: 'Open to research partnerships.',
    public_email: 'hello@example.org',
    focus_areas: ['Digital rights', 'Gender justice & technology'],
    matched: true,
    logo_path: 'organisation-logos/logos/example-organisation.webp',
    photo_path: 'organisation-photos/photos/example-organisation.webp',
    photo_alt: 'Programme photo.',
    publication_status: 'published',
    last_reviewed: '2026-01-15T00:00:00.000Z',
    organisation_types: [{ cso_type: 'Women-focused' }, { cso_type: 'Youth-focused' }],
    offerings: [
      { kind: 'service', name: 'Digital skills training', description: 'Practical training.', category: '', sort_order: 0, publication_status: 'published' },
      { kind: 'tool', name: 'Incident map', description: 'A public map.', category: '', sort_order: 1, publication_status: 'published' },
      { kind: 'tool', name: 'Hidden draft', description: 'Not ready.', category: '', sort_order: 2, publication_status: 'draft' },
    ],
    contacts: [
      { type: 'Email', name: 'Programme team', email: 'programmes@example.org', number: '', url: '', role: 'Enquiries', description: '', sort_order: 2, publication_status: 'published' },
      { type: 'Number', name: 'Hotline', email: '', number: '+254700000000', url: '', role: '', description: '', sort_order: 1, publication_status: 'published' },
    ],
    resources: [
      { title: 'Research guide', url: 'https://example.org/guide', description: 'A guide.', sort_order: 0, publication_status: 'published' },
      { title: 'Unpublished draft', url: 'https://example.org/draft', description: '', sort_order: 1, publication_status: 'draft' },
    ],
    social_links: [
      { platform: 'x', url: 'https://x.com/example', sort_order: 1 },
      { platform: 'website', url: 'https://example.org', sort_order: 0 },
    ],
    ...overrides,
  };
}

function createStore(fetchImpl) {
  globalThis.fetch = fetchImpl;
  return new SupabaseStore({ baseUrl: BASE_URL, serviceRoleKey: 'service-role-key' });
}

test('Supabase adapter joins published records and maps them for the directory', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  let requestedUrl = '';
  const store = createStore(async (input) => {
    requestedUrl = String(input);
    return jsonResponse([
      publishedOrganisation(),
      publishedOrganisation({
        slug: 'hidden-organisation',
        name: 'Hidden Organisation',
        publication_status: 'draft',
      }),
    ]);
  });

  const records = await store.listDirectory();
  assert.equal(records.length, 1, 'Only published organisations are returned.');

  const [record] = records;
  assert.equal(record.id, 'example-organisation');
  assert.equal(record.source, 'supabase');
  assert.deepEqual(record.type, ['Women-focused', 'Youth-focused']);
  assert.deepEqual(record.focus, ['Digital rights', 'Gender justice & technology']);
  assert.deepEqual(
    record.offerings.tools.map((item) => item.name),
    ['Incident map'],
    'Draft offerings are excluded.',
  );
  assert.deepEqual(
    record.offerings.services.map((item) => item.name),
    ['Digital skills training'],
  );
  assert.deepEqual(
    record.contacts.map((contact) => contact.name),
    ['Hotline', 'Programme team'],
    'Contacts keep their sort order.',
  );
  assert.deepEqual(
    record.resources.map((resource) => resource.title),
    ['Research guide'],
    'Draft resources are excluded.',
  );
  assert.deepEqual(record.social, [
    { type: 'website', url: 'https://example.org' },
    { type: 'x', url: 'https://x.com/example' },
  ]);
  assert.equal(record.logo, `${BASE_URL}/storage/v1/object/public/organisation-logos/logos/example-organisation.webp`);
  assert.equal(record.photo, `${BASE_URL}/storage/v1/object/public/organisation-photos/photos/example-organisation.webp`);
  assert.equal(record.publicEmail, 'hello@example.org');

  const url = new URL(requestedUrl);
  assert.equal(url.pathname, '/rest/v1/organisations');
  assert.equal(url.searchParams.get('order'), 'name.asc');
});

test('Supabase adapter uploads submission images and inserts the review row', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const storageUploads = [];
  const submissions = [];
  const store = createStore(async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith('/storage/v1/object/')) {
      storageUploads.push({ pathname: url.pathname, contentType: options.headers['Content-Type'] });
      return new Response('{}', { status: 200 });
    }
    if (url.pathname === '/rest/v1/submissions') {
      submissions.push(JSON.parse(options.body));
      return jsonResponse([JSON.parse(options.body)]);
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  });

  const payload = {
    requestType: 'New organisation',
    organisationId: '',
    organisationName: 'New Organisation',
    summary: 'A short introduction.',
  };
  const photo = {
    contentType: 'image/webp',
    buffer: Buffer.from('photo-bytes'),
    filename: 'photo.webp',
    base64: Buffer.from('photo-bytes').toString('base64'),
  };

  const result = await store.createSubmission(payload, photo, null);
  assert.equal(result.table, 'submissions');
  assert.equal(storageUploads.length, 1);
  assert.match(storageUploads[0].pathname, /^\/storage\/v1\/object\/submission-uploads\/[0-9a-f-]{36}\/photo\.webp$/);
  assert.equal(storageUploads[0].contentType, 'image/webp');

  assert.equal(submissions.length, 1);
  const [submission] = submissions;
  assert.equal(submission.id, result.id);
  assert.equal(submission.request_type, 'New organisation');
  assert.equal(submission.organisation_slug, null);
  assert.equal(submission.review_status, 'Pending');
  assert.equal(submission.payload.summary, 'A short introduction.');
  assert.match(submission.photo_path, /^submission-uploads\/[0-9a-f-]{36}\/photo\.webp$/);
  assert.equal(submission.logo_path, '');
});

test('Supabase adapter stores collaboration requests', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  let stored;
  const store = createStore(async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/rest/v1/collaboration_requests');
    stored = JSON.parse(options.body);
    return jsonResponse([stored]);
  });

  const created = await store.createCollaborationRequest({
    recipientOrganisation: 'Example Organisation',
    senderOrganisation: 'Another Organisation',
    senderName: 'Sam Sender',
    senderEmail: 'sam@example.org',
    collaborationType: 'Research',
    message: 'We would like to work together.',
  });

  assert.equal(created.recipient_organisation, 'Example Organisation');
  assert.equal(stored.sender_email, 'sam@example.org');
  assert.equal(stored.status, 'New');
});

test('Supabase adapter reports its connection health', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const store = createStore(async () => jsonResponse([{ slug: 'example-organisation' }]));
  assert.deepEqual(await store.health(), { database: 'supabase', connected: true });
});
