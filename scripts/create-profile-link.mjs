import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../server/lib/env.mjs';
import { extractDirectoryData } from '../server/lib/directory-data.mjs';
import { createProfileToken } from '../server/lib/tokens.mjs';

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

const organisationId = organisation.name
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');
const token = createProfileToken({
  organisationId,
  organisationName: organisation.name,
  secret,
  ttlSeconds: days * 24 * 60 * 60,
});

const baseUrl = new URL(process.env.PUBLIC_BASE_URL || 'http://localhost:3000');
baseUrl.searchParams.set('edit', token);
baseUrl.hash = `directory?profile=${encodeURIComponent(organisation.name)}`;

console.log(`Private edit link for ${organisation.name} (valid for ${days} days):`);
console.log(baseUrl.toString());
