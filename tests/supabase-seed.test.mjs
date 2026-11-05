import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { buildSeed, slugify } from '../scripts/build-supabase-seed.mjs';
import { extractDirectoryData } from '../server/lib/directory-data.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

test('supabase seed covers every embedded organisation', () => {
  const { data } = extractDirectoryData(root);
  const { sql, stats } = buildSeed(root);

  assert.equal(stats.organisations, 46);
  assert.equal(stats.organisations, data.length);
  assert.ok(stats.organisationTypes > 0, 'CSO types must be seeded.');
  assert.ok(stats.offerings > 0, 'Offerings must be seeded.');
  assert.match(sql, /on conflict \(slug\) do update/);
  assert.match(sql, /\ncommit;\n$/);

  const slugs = data.map((record) => slugify(record.name));
  assert.equal(new Set(slugs).size, slugs.length, 'Slugs must be unique.');
  for (const slug of slugs) {
    assert.ok(sql.includes(`(${sqlString(slug)}`), `Seed is missing slug "${slug}".`);
  }
});

test('supabase/seed.sql on disk matches the directory source', async () => {
  const committed = await readFile(resolve(root, 'supabase', 'seed.sql'), 'utf8');
  const { sql } = buildSeed(root);
  assert.equal(
    committed,
    sql,
    'supabase/seed.sql is out of date — run `npm run build:seed` and commit the result.',
  );
});

test('seed storage paths point at the local image files', async () => {
  const { data } = extractDirectoryData(root);
  const { sql } = buildSeed(root);

  for (const record of data) {
    if (record.logo) {
      const storagePath = `organisation-logos/${record.logo.replace(/^assets\//, '')}`;
      assert.ok(sql.includes(sqlString(storagePath)), `Missing logo path for ${record.name}.`);
      await access(resolve(root, record.logo));
    }
    if (record.photo) {
      const storagePath = `organisation-photos/${record.photo.replace(/^assets\//, '')}`;
      assert.ok(sql.includes(sqlString(storagePath)), `Missing photo path for ${record.name}.`);
      await access(resolve(root, record.photo));
    }
  }
});
