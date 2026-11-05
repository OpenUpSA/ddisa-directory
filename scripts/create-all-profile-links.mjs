import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../server/lib/env.mjs';
import { extractDirectoryData } from '../server/lib/directory-data.mjs';
import { createProfileToken } from '../server/lib/tokens.mjs';
import { slugify } from '../server/lib/validation.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

/**
 * One CSV cell: quote fields containing commas, quotes or newlines.
 */
export function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Build a mail-merge CSV of private edit links.
 * One row per organisation: name, slug, public email, link, expiry.
 */
export function buildLinksCsv(organisations, { days, secret, baseUrl }) {
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const header = ['organisation', 'slug', 'public_email', 'edit_link', 'expires_at'];
  const rows = organisations.map((organisation) => {
    const url = new URL(String(baseUrl));
    url.searchParams.set(
      'edit',
      createProfileToken({
        organisationId: organisation.slug,
        organisationName: organisation.name,
        secret,
        ttlSeconds: days * 24 * 60 * 60,
        ...(organisation.version !== undefined && organisation.version !== null
          ? { version: organisation.version }
          : {}),
      }),
    );
    url.hash = `directory?profile=${encodeURIComponent(organisation.name)}`;
    return [organisation.name, organisation.slug, organisation.publicEmail || '', url.toString(), expiresAt];
  });
  return `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

/**
 * Organisations to issue links for. Uses Supabase (slug, current
 * token_version, public email — includes newly published orgs) when
 * configured, otherwise falls back to the embedded directory snapshot.
 */
export async function loadOrganisations() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && serviceKey && !serviceKey.startsWith('replace-')) {
    const response = await fetch(
      `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/organisations?select=slug,name,token_version,public_email&order=name.asc&limit=1000`,
      {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Supabase returned ${response.status} — has supabase/seed.sql been run?`);
    }
    const rows = await response.json();
    if (!rows.length) throw new Error('No organisations found in Supabase — run supabase/seed.sql first.');
    return rows.map((row) => ({
      slug: row.slug,
      name: row.name,
      version: Number.isInteger(row.token_version) ? row.token_version : 1,
      publicEmail: row.public_email || '',
    }));
  }

  const { data } = extractDirectoryData(root);
  return data
    .map((record) => ({
      slug: slugify(record.name),
      name: record.name,
      version: 1,
      publicEmail: '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function main() {
  loadEnv(root);

  const days = Math.min(Math.max(Number(process.argv[2] || 30), 1), 365);
  if (!Number.isFinite(days)) {
    throw new Error('Usage: npm run invite:all -- [days]');
  }
  const secret = process.env.PROFILE_LINK_SECRET;
  if (!secret || secret.startsWith('replace-') || secret.length < 32) {
    throw new Error(
      'Set PROFILE_LINK_SECRET to at least 32 random characters in .env first ' +
        '(node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))").',
    );
  }

  const organisations = await loadOrganisations();
  const csv = buildLinksCsv(organisations, {
    days,
    secret,
    baseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3000',
  });

  const outputDir = resolve(root, '.data');
  await mkdir(outputDir, { recursive: true });
  const output = resolve(outputDir, 'edit-links.csv');
  await writeFile(output, csv);

  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  console.log(`Wrote ${organisations.length} private edit links to ${output}`);
  console.log(`Valid ${days} day${days === 1 ? '' : 's'} — all links expire ${expires}.`);
  console.log(
    'This CSV contains live credentials for every profile: keep it private, use it for mail merge, then delete it. (.data/ is gitignored.)',
  );
  const missingEmail = organisations.filter((organisation) => !organisation.publicEmail).length;
  if (missingEmail) {
    console.log(`Note: ${missingEmail} organisations have no public_email in Supabase yet — that column is blank.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
