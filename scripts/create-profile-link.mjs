import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../server/lib/env.mjs';
import { extractDirectoryData } from '../server/lib/directory-data.mjs';
import { createProfileToken } from '../server/lib/tokens.mjs';
import { slugify } from '../server/lib/validation.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
loadEnv(root);

const organisationName = process.argv[2];
if (!organisationName) {
  console.error('Usage: npm run invite -- "Organisation name" [days]');
  process.exit(1);
}

const days = Math.min(Math.max(Number(process.argv[3] || 30), 1), 365);
const secret = process.env.PROFILE_LINK_SECRET;
if (!secret || secret.startsWith('replace-') || secret.length < 32) {
  throw new Error('Set PROFILE_LINK_SECRET to at least 32 random characters.');
}

const { data } = extractDirectoryData(root);
const organisation = data.find(
  (row) => row.name.toLocaleLowerCase() === organisationName.toLocaleLowerCase(),
);
if (!organisation) {
  console.error(`No organisation named "${organisationName}" was found.`);
  process.exit(1);
}

const organisationId = slugify(organisation.name);

// Embed the organisation's current token_version (Supabase) so DDISA can
// revoke every outstanding link by bumping that one column.
let version;
if (
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !process.env.SUPABASE_SERVICE_ROLE_KEY.startsWith('replace-')
) {
  const baseUrl = process.env.SUPABASE_URL.replace(/\/+$/, '');
  try {
    const response = await fetch(
      `${baseUrl}/rest/v1/organisations?slug=eq.${encodeURIComponent(organisationId)}&select=token_version`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.ok) {
      const [row] = await response.json();
      if (row) {
        version = row.token_version ?? 1;
      } else {
        console.warn(`Note: "${organisationId}" is not in Supabase yet; assuming token version 1.`);
      }
    } else {
      console.warn('Warning: could not read token_version from Supabase; assuming version 1.');
    }
  } catch {
    console.warn('Warning: Supabase was unreachable; assuming token version 1.');
  }
}

const token = createProfileToken({
  organisationId,
  organisationName: organisation.name,
  secret,
  ttlSeconds: days * 24 * 60 * 60,
  ...(version !== undefined ? { version } : {}),
});

const baseUrl = new URL(process.env.PUBLIC_BASE_URL || 'http://localhost:3000');
baseUrl.searchParams.set('edit', token);
baseUrl.hash = `directory?profile=${encodeURIComponent(organisation.name)}`;

console.log(`Private edit link for ${organisation.name} (valid for ${days} days):`);
console.log(baseUrl.toString());
