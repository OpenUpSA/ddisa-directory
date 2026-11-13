import assert from 'node:assert/strict';
import test from 'node:test';
import { handler as accessHandler } from '../functions/access.mjs';
import { handler as submissionsHandler } from '../functions/submissions.mjs';
import { handler as collaborationHandler } from '../functions/collaboration-requests.mjs';

// Must be set before any handler runs (handlers read env lazily; loadEnv
// never overrides existing values).
process.env.SUPABASE_URL = 'https://unit-test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-unit-test-key';
process.env.SUPABASE_ANON_KEY = 'anon-unit-test-key';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const LINKED_ORGANISATION = {
  slug: 'digital-woman-uganda',
  name: 'Digital Woman Uganda',
  publication_status: 'published',
};

function installFetch(context, responder) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    let parsed = null;
    if (typeof options.body === 'string') {
      try {
        parsed = JSON.parse(options.body);
      } catch {
        parsed = null;
      }
    }
    const call = {
      method: options.method || 'GET',
      pathname: url.pathname,
      search: url.search,
      headers: options.headers || {},
      body: options.body ?? null,
      json: parsed,
    };
    calls.push(call);
    return responder(call);
  };
  context.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

function postEvent(body, ip, authorization) {
  return {
    httpMethod: 'POST',
    headers: {
      'x-forwarded-for': ip,
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

// GoTrue responder: "Bearer good-jwt" is a valid session for user-1.
function authUser(call) {
  const authorization = String(call.headers?.authorization || call.headers?.Authorization || '');
  if (authorization === 'Bearer good-jwt') return json({ id: 'user-1', email: 'editor@digitalwoman.example' });
  return json({ message: 'JWT expired' }, 401);
}

// --- access -----------------------------------------------------------------

test('access returns the organisation linked to the signed-in user', async (context) => {
  const calls = installFetch(context, (call) => {
    if (call.pathname === '/auth/v1/user') return authUser(call);
    if (call.search.includes('owner_id=eq.')) return json([LINKED_ORGANISATION]);
    return json([]);
  });

  const response = await accessHandler({
    httpMethod: 'GET',
    headers: { authorization: 'Bearer good-jwt' },
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.organisationId, 'digital-woman-uganda');
  assert.equal(body.organisationName, 'Digital Woman Uganda');
  assert.equal(body.email, 'editor@digitalwoman.example');
  assert.equal(calls.length, 2);
  assert.equal(response.headers['Cache-Control'], 'no-store');
});

test('access rejects anonymous requests without touching the database', async (context) => {
  const calls = installFetch(context, () => {
    throw new Error('fetch must not be called without a session');
  });

  const response = await accessHandler({ httpMethod: 'GET', headers: {} });

  assert.equal(response.statusCode, 401);
  assert.match(JSON.parse(response.body).error, /Sign in/);
  assert.equal(calls.length, 0);
});

test('access rejects expired or invalid sessions', async (context) => {
  const calls = installFetch(context, (call) => {
    if (call.pathname === '/auth/v1/user') return json({ message: 'JWT expired' }, 401);
    throw new Error('organisation lookup must not run for invalid sessions');
  });

  const response = await accessHandler({
    httpMethod: 'GET',
    headers: { authorization: 'Bearer expired-jwt' },
  });

  assert.equal(response.statusCode, 401);
  assert.match(JSON.parse(response.body).error, /session has expired/);
  assert.equal(calls.length, 1);
});

test('access 403s for a signed-in user with no linked organisation', async (context) => {
  installFetch(context, (call) => {
    if (call.pathname === '/auth/v1/user') return authUser(call);
    if (call.search.includes('owner_id=eq.')) return json([]);
    return json([]);
  });

  const response = await accessHandler({
    httpMethod: 'GET',
    headers: { authorization: 'Bearer good-jwt' },
  });

  assert.equal(response.statusCode, 403);
  assert.match(JSON.parse(response.body).error, /not linked to an organisation/);
});

test('access flags support admins so they can edit any organisation', async (context) => {
  installFetch(context, (call) => {
    if (call.pathname === '/auth/v1/user') return authUser(call);
    if (call.pathname === '/rest/v1/support_admins') return json([{ user_id: 'user-1' }]);
    if (call.search.includes('owner_id=eq.')) return json([]);
    return json([]);
  });

  const adminResponse = await accessHandler({
    httpMethod: 'GET',
    headers: { authorization: 'Bearer good-jwt' },
  });

  assert.equal(adminResponse.statusCode, 200);
  const body = JSON.parse(adminResponse.body);
  assert.equal(body.isAdmin, true);
  assert.equal(body.organisationId, null, 'admin with no linked org gets a null organisation');
  assert.equal(body.email, 'editor@digitalwoman.example');
});

test('access reports 503 when Supabase Auth is unreachable', async (context) => {
  installFetch(context, () => {
    throw new Error('connection refused');
  });

  const response = await accessHandler({
    httpMethod: 'GET',
    headers: { authorization: 'Bearer good-jwt' },
  });

  assert.equal(response.statusCode, 503);
  // 5xx bodies are masked to the generic message by errorResponse().
  assert.match(JSON.parse(response.body).error, /could not complete that request/);
});

// --- submissions: profile updates -------------------------------------------

test('profile updates publish directly with images and child rows', async (context) => {
  const photoBase64 = Buffer.from('fake-image-bytes').toString('base64');
  const calls = installFetch(context, ({ method, pathname, search }) => {
    if (pathname === '/auth/v1/user') return authUser({ headers: { authorization: 'Bearer good-jwt' } });
    if (pathname === '/rest/v1/organisations' && method === 'GET') {
      if (search.includes('owner_id=eq.')) {
        return json([LINKED_ORGANISATION]);
      }
      return json([
        { id: 'org-uuid-1', slug: 'digital-woman-uganda', name: 'Digital Woman Uganda', photo_path: '', logo_path: '' },
      ]);
    }
    if (pathname.startsWith('/storage/v1/object/')) return new Response('{}', { status: 200 });
    if (pathname === '/rest/v1/organisations' && method === 'PATCH') return json([{ slug: 'digital-woman-uganda' }]);
    return json([]);
  });

  const response = await submissionsHandler(
    postEvent(
      {
        contactEmail: 'hello@digitalwoman.example',
        summary: 'Updated summary.',
        description: 'Updated description.',
        collaboration: 'Open to research partnerships.',
        type: ['Women-focused'],
        contacts: [{ type: 'Email', name: 'Programme team', email: 'programme@digitalwoman.example', role: 'Programmes' }],
        offerings: { tools: [{ name: 'IVR platform', description: 'Delivers information by voice.' }], services: [] },
        resources: [],
        photoAlt: 'Programme photo.',
        photo: { dataUrl: `data:image/webp;base64,${photoBase64}`, filename: 'photo.webp' },
      },
      '10.1.1.1',
      'Bearer good-jwt',
    ),
  );

  assert.equal(response.statusCode, 201);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.submissionId, 'digital-woman-uganda');

  const patch = calls.find((call) => call.method === 'PATCH');
  assert.ok(patch, 'organisation row must be updated');
  assert.equal(patch.json.summary, 'Updated summary.');
  assert.equal(patch.json.public_email, 'hello@digitalwoman.example');
  assert.equal(patch.json.photo_path, 'organisation-photos/profiles/digital-woman-uganda.webp');

  const upload = calls.find((call) => call.pathname.startsWith('/storage/v1/object/'));
  assert.ok(upload, 'photo must be uploaded');
  assert.equal(upload.pathname, '/storage/v1/object/organisation-photos/profiles/digital-woman-uganda.webp');

  const deletes = calls.filter((call) => call.method === 'DELETE');
  assert.equal(deletes.length, 4, 'all four child tables are replaced');

  const types = calls.find((call) => call.pathname === '/rest/v1/organisation_types' && call.method === 'POST');
  assert.deepEqual(types.json, [{ organisation_id: 'org-uuid-1', cso_type: 'Women-focused' }]);

  const offerings = calls.find((call) => call.pathname === '/rest/v1/offerings' && call.method === 'POST');
  assert.equal(offerings.json[0].kind, 'tool');
  assert.equal(offerings.json[0].sort_order, 0);

  const contacts = calls.find((call) => call.pathname === '/rest/v1/contacts' && call.method === 'POST');
  assert.equal(contacts.json[0].email, 'programme@digitalwoman.example');

  const audit = calls.find((call) => call.pathname === '/rest/v1/submissions' && call.method === 'POST');
  assert.equal(audit.json.review_status, 'Approved');
  assert.equal(audit.json.organisation_slug, 'digital-woman-uganda');
  assert.match(audit.json.internal_notes, /Published automatically/);
});

test('support admins can publish updates to any organisation', async (context) => {
  const calls = installFetch(context, ({ method, pathname, search }) => {
    if (pathname === '/auth/v1/user') return authUser({ headers: { authorization: 'Bearer good-jwt' } });
    if (pathname === '/rest/v1/support_admins') return json([{ user_id: 'user-1' }]);
    if (search.includes('owner_id=eq.')) return json([]); // no linked org for this admin
    if (search.includes('select=slug,name,publication_status')) {
      // editorFromRequest resolving the client-named target organisation
      return json([LINKED_ORGANISATION]);
    }
    if (pathname === '/rest/v1/organisations' && method === 'GET') {
      return json([
        { id: 'org-uuid-1', slug: 'digital-woman-uganda', name: 'Digital Woman Uganda', photo_path: '', logo_path: '' },
      ]);
    }
    if (pathname.startsWith('/storage/v1/object/')) return new Response('{}', { status: 200 });
    if (pathname === '/rest/v1/organisations' && method === 'PATCH') return json([{ slug: 'digital-woman-uganda' }]);
    return json([]);
  });

  const response = await submissionsHandler(
    postEvent(
      {
        // The admin names the target — owners never send this for their own
        // org (the server resolves it from owner_id instead).
        organisationId: 'digital-woman-uganda',
        contactEmail: 'hello@digitalwoman.example',
        summary: 'Admin-edited summary.',
        description: 'Admin-edited description.',
        type: ['Women-focused'],
      },
      '10.1.7.1',
      'Bearer good-jwt',
    ),
  );

  assert.equal(response.statusCode, 201);
  const body = JSON.parse(response.body);
  assert.equal(body.submissionId, 'digital-woman-uganda');

  const patch = calls.find((call) => call.method === 'PATCH');
  assert.ok(patch, 'organisation row must be updated');
  assert.equal(patch.json.summary, 'Admin-edited summary.');

  const audit = calls.find((call) => call.pathname === '/rest/v1/submissions' && call.method === 'POST');
  assert.equal(audit.json.request_type, 'Profile update');
  assert.equal(audit.json.organisation_slug, 'digital-woman-uganda');
});

test('profile updates from a user with no linked organisation return 403', async (context) => {
  installFetch(context, (call) => {
    if (call.pathname === '/auth/v1/user') return authUser(call);
    if (call.search.includes('owner_id=eq.')) return json([]);
    return json([]);
  });

  const response = await submissionsHandler(
    postEvent(
      {
        contactEmail: 'ghost@example.org',
        summary: 'Summary.',
        description: 'Description.',
        type: ['Youth-focused'],
      },
      '10.1.5.1',
      'Bearer good-jwt',
    ),
  );

  assert.equal(response.statusCode, 403);
  assert.match(JSON.parse(response.body).error, /not linked to an organisation/);
});

test('an expired session cannot submit updates', async (context) => {
  installFetch(context, (call) => {
    if (call.pathname === '/auth/v1/user') return json({ message: 'JWT expired' }, 401);
    throw new Error('organisation lookup must not run for invalid sessions');
  });

  const response = await submissionsHandler(
    postEvent(
      {
        contactEmail: 'hello@digitalwoman.example',
        summary: 'Summary.',
        description: 'Description.',
        type: ['Women-focused'],
      },
      '10.1.6.1',
      'Bearer expired-jwt',
    ),
  );

  assert.equal(response.statusCode, 401);
  assert.match(JSON.parse(response.body).error, /session has expired/);
});

// --- submissions: new organisations -----------------------------------------

test('new organisations publish with slug, website and images', async (context) => {
  const logoBase64 = Buffer.from('fake-logo-bytes').toString('base64');
  const calls = installFetch(context, ({ method, pathname }) => {
    if (pathname === '/rest/v1/organisations' && method === 'GET') {
      return json([{ slug: 'existing-organisation', name: 'Existing Organisation' }]);
    }
    if (pathname === '/rest/v1/organisations' && method === 'POST') {
      return json([{ id: 'org-uuid-new' }]);
    }
    if (pathname.startsWith('/storage/v1/object/')) return new Response('{}', { status: 200 });
    return json([]);
  });

  const response = await submissionsHandler(
    postEvent(
      {
        organisationName: 'Test Organisation',
        contactEmail: 'hello@testorg.example',
        country: 'Kenya',
        region: 'Eastern Africa',
        website: 'https://testorg.example',
        summary: 'A short introduction.',
        description: 'A full description of the organisation.',
        collaboration: 'Open to partnerships.',
        type: ['Youth-focused', 'Women-focused'],
        contacts: [],
        offerings: { tools: [], services: [{ name: 'Training', description: 'Practical training.' }] },
        resources: [],
        photoAlt: '',
        logo: { dataUrl: `data:image/png;base64,${logoBase64}`, filename: 'logo.png' },
      },
      '10.1.2.1',
    ),
  );

  assert.equal(response.statusCode, 201);
  assert.equal(JSON.parse(response.body).submissionId, 'test-organisation');

  const insert = calls.find((call) => call.pathname === '/rest/v1/organisations' && call.method === 'POST');
  assert.equal(insert.json.slug, 'test-organisation');
  assert.equal(insert.json.publication_status, 'published');
  assert.equal(insert.json.matched, true);
  assert.deepEqual(insert.json.focus_areas, []);
  assert.equal(insert.json.logo_path, 'organisation-logos/logos/test-organisation.png');

  const upload = calls.find((call) => call.pathname.startsWith('/storage/v1/object/'));
  assert.equal(upload.pathname, '/storage/v1/object/organisation-logos/logos/test-organisation.png');

  const social = calls.find((call) => call.pathname === '/rest/v1/social_links' && call.method === 'POST');
  assert.equal(social.json[0].platform, 'website');
  assert.ok(social.json[0].url.startsWith('https://testorg.example'));

  const audit = calls.find((call) => call.pathname === '/rest/v1/submissions' && call.method === 'POST');
  assert.equal(audit.json.request_type, 'New organisation');
  assert.equal(audit.json.organisation_slug, 'test-organisation');
});

test('duplicate organisations are rejected with 409', async (context) => {
  installFetch(context, () =>
    json([{ slug: 'test-organisation', name: 'Test Organisation' }]),
  );

  const response = await submissionsHandler(
    postEvent(
      {
        organisationName: 'Test Organisation',
        contactEmail: 'hello@testorg.example',
        country: 'Kenya',
        region: 'Eastern Africa',
        summary: 'A short introduction.',
        description: 'A full description.',
        type: ['Youth-focused'],
      },
      '10.1.3.1',
    ),
  );

  assert.equal(response.statusCode, 409);
  assert.match(JSON.parse(response.body).error, /already in the directory/);
});

test('invalid submission payloads are rejected with 400', async (context) => {
  installFetch(context, () => {
    throw new Error('fetch must not be called for invalid payloads');
  });

  const response = await submissionsHandler(
    postEvent(
      {
        organisationName: 'Test Organisation',
        contactEmail: 'hello@testorg.example',
        country: 'Kenya',
        region: 'Eastern Africa',
        description: 'A full description.',
        type: ['Youth-focused'],
        // summary intentionally missing
      },
      '10.1.4.1',
    ),
  );

  assert.equal(response.statusCode, 400);
  assert.match(JSON.parse(response.body).error, /Card introduction is required/);
});

test('submissions are rate limited per connection', async (context) => {
  installFetch(context, () => {
    throw new Error('fetch must not be called once rate limited');
  });

  let last;
  for (let attempt = 0; attempt < 9; attempt += 1) {
    last = await submissionsHandler(postEvent({}, '10.2.2.2'));
  }
  assert.equal(last.statusCode, 429);
  assert.match(JSON.parse(last.body).error, /Too many submissions/);
});

// --- collaboration requests --------------------------------------------------

test('collaboration requests persist with the consent flag', async (context) => {
  const calls = installFetch(context, ({ pathname, method }) => {
    if (pathname === '/rest/v1/collaboration_requests' && method === 'POST') {
      return json([{ id: 'collab-1' }]);
    }
    return json([]);
  });

  const response = await collaborationHandler(
    postEvent(
      {
        recipientOrganisation: 'Digital Woman Uganda',
        senderOrganisation: 'Test Organisation',
        senderName: 'Sam Sender',
        senderEmail: 'sam@testorg.example',
        collaborationType: 'Research and evidence',
        message: 'We would like to evaluate your IVR platform together.',
        consentShared: true,
      },
      '10.3.3.3',
    ),
  );

  assert.equal(response.statusCode, 201);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.match(body.message, /received/);

  const insert = calls.find((call) => call.pathname === '/rest/v1/collaboration_requests');
  assert.equal(insert.json.recipient_organisation, 'Digital Woman Uganda');
  assert.equal(insert.json.consent_shared, true);
  assert.equal(insert.json.status, 'New');
});

test('collaboration requests require consent and all fields', async (context) => {
  installFetch(context, () => {
    throw new Error('fetch must not be called for invalid payloads');
  });

  const response = await collaborationHandler(
    postEvent(
      {
        recipientOrganisation: 'Digital Woman Uganda',
        senderOrganisation: 'Test Organisation',
        senderName: 'Sam Sender',
        senderEmail: 'not-an-email',
        collaborationType: 'Research',
        message: '',
        consentShared: true,
      },
      '10.3.4.4',
    ),
  );

  assert.equal(response.statusCode, 400);
});
