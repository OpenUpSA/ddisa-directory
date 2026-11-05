// Static-directory runtime — injected into netlify/index.html by
// scripts/build-netlify.mjs, replacing the API-backed versions.
// These functions live in the page's main <script>, so they share scope with
// esc(), $(), data, offeringsByName, focusGroups and the other globals.

// Maps a PostgREST row from Supabase to the directory record shape the UI
// expects (same mapping as server/lib/supabase-store.mjs).
function mapSupabaseOrganisation(row) {
  const asList = (value) => (Array.isArray(value) ? value : []);
  const isPublished = (child) =>
    child.publication_status !== 'draft' && child.publication_status !== 'archived';
  const baseUrl = String(window.DDISA_ENV?.SUPABASE_URL || '').replace(/\/+$/, '');
  const publicUrl = (path) => {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    const slash = path.indexOf('/');
    if (slash < 1) return '';
    return `${baseUrl}/storage/v1/object/public/${path}`;
  };

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
    type: asList(row.organisation_types).map((item) => item.cso_type),
    cohort: row.cohort || 'Cohort 1',
    description: row.description || '',
    collaboration: row.collaboration || '',
    publicEmail: row.public_email || '',
    matched: Boolean(row.matched),
    social: social.map((link) => ({ type: link.platform, url: link.url })),
    offerings: {
      tools: offerings
        .filter((item) => item.kind === 'tool')
        .map((item) => ({ name: item.name, description: item.description, category: item.category || '' })),
      services: offerings
        .filter((item) => item.kind === 'service')
        .map((item) => ({ name: item.name, description: item.description, category: item.category || '' })),
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
    logo: publicUrl(row.logo_path),
    photo: publicUrl(row.photo_path),
    photoAlt: row.photo_alt || '',
    logoBackground: row.logo_background || '',
    summary: row.summary || '',
    lastReviewed: row.last_reviewed || null,
    source: 'supabase',
  };
}

// Loads published profiles straight from Supabase with the anon key.
// Write flows (submissions, edit links, collaboration requests) arrive with
// the Supabase Auth + server-function work and stay disabled until then.
async function hydrateDirectory() {
  if (!databaseOnline) return;
  const config = window.DDISA_ENV || {};
  const baseUrl = String(config.SUPABASE_URL || '').replace(/\/+$/, '');
  const anonKey = config.SUPABASE_ANON_KEY || '';
  if (!baseUrl || !anonKey || baseUrl.includes('YOUR-PROJECT')) {
    setAlert(
      'app-alert',
      'This deployment is not connected to Supabase yet. Set SUPABASE_URL and SUPABASE_ANON_KEY in netlify/config.js (or as Netlify environment variables) and rebuild.',
      'error',
    );
    return;
  }
  try {
    const select = [
      'slug', 'name', 'country', 'region', 'cohort', 'summary', 'description',
      'collaboration', 'public_email', 'focus_areas', 'matched', 'logo_path',
      'photo_path', 'photo_alt', 'logo_background', 'last_reviewed',
      'publication_status', 'organisation_types(cso_type)',
      'offerings(kind,name,description,category,sort_order,publication_status)',
      'contacts(type,name,email,number,url,role,description,sort_order,publication_status)',
      'resources(title,url,description,sort_order,publication_status)',
      'social_links(platform,url,sort_order)',
    ].join(',');
    const response = await fetch(
      `${baseUrl}/rest/v1/organisations?select=${encodeURIComponent(select)}&publication_status=eq.published&order=name.asc`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          Accept: 'application/json',
        },
      },
    );
    if (!response.ok) throw new Error(`Supabase returned ${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows) || !rows.length) {
      throw new Error('No published organisations were returned');
    }
    const records = rows.map(mapSupabaseOrganisation);
    data.splice(0, data.length, ...records);
    records.forEach((record) => {
      offeringsByName[record.name] = record.offerings;
    });
    populateFilters();
    applyStateFromHash();
    const source = 'Live directory';
    document.querySelector('.private').textContent = source;
    document.querySelector('.private').title = source;
    setAlert('app-alert', '', '');
    $('open-add-organisation').hidden = false;
  } catch (error) {
    console.warn('Supabase directory unavailable.', error);
    setAlert(
      'app-alert',
      'The directory could not be loaded from Supabase right now. Please try again shortly.',
      'error',
    );
  }
  await initialiseEditAccess();
}

// collaborationMarkup is kept from the source HTML: its request buttons now
// work against /.netlify/functions/collaboration-requests.
