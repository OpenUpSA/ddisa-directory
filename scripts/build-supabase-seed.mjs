import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extractDirectoryData } from '../server/lib/directory-data.mjs';
import { COUNTRIES, REGIONS, CSO_TYPES, slugify } from '../server/lib/validation.mjs';

// Re-exported for existing tests/tools that import it from here.
export { slugify };

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outputPath = resolve(root, 'supabase', 'seed.sql');

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlTextArray(items) {
  if (!items.length) return "'{}'::text[]";
  return `array[${items.map(sqlString).join(', ')}]`;
}

function storagePath(bucket, assetPath) {
  if (!assetPath) return '';
  if (/^https?:\/\//i.test(assetPath)) return assetPath;
  return `${bucket}/${String(assetPath).replace(/^assets\//, '')}`;
}

function childInsert(table, columns, alias, rows) {
  return [
    `insert into public.${table} (${columns.join(', ')})`,
    'select',
    `  ${columns.map((column, index) => (index === 0 ? 'o.id' : `v.${column}`)).join(', ')}`,
    'from (values',
    rows.join(',\n'),
    `) as ${alias}`,
    'join public.organisations o on o.slug = v.slug;',
  ].join('\n');
}

function childDelete(table, slugs) {
  return [
    `delete from public.${table}`,
    'where organisation_id in (',
    '  select id from public.organisations',
    `  where slug in (${slugs.map(sqlString).join(', ')})`,
    ');',
  ].join('\n');
}

export function buildSeed(directoryRoot = root) {
  const { data, offeringsByName } = extractDirectoryData(directoryRoot);
  const problems = [];
  const seen = new Map();

  const organisations = data.map((record) => {
    const slug = slugify(record.name);
    if (!slug) problems.push(`No slug could be derived from "${record.name}".`);
    if (seen.has(slug)) {
      problems.push(`Slug "${slug}" is shared by "${seen.get(slug)}" and "${record.name}".`);
    }
    seen.set(slug, record.name);
    if (!COUNTRIES.has(record.country)) {
      problems.push(`${record.name}: country "${record.country}" is not in the eligible list.`);
    }
    if (!REGIONS.has(record.region)) {
      problems.push(`${record.name}: region "${record.region}" is not a valid region.`);
    }
    if (!record.summary) problems.push(`${record.name}: missing summary.`);
    if (!record.description) problems.push(`${record.name}: missing description.`);

    const types = [...new Set(record.type || [])].filter((type) => CSO_TYPES.has(type));
    const focus = [...new Set(record.focus || [])];
    const offerings = offeringsByName[record.name] || { tools: [], services: [] };

    return {
      slug,
      name: record.name,
      country: record.country,
      region: record.region,
      cohort: record.cohort || 'Cohort 1',
      summary: record.summary || '',
      description: record.description || '',
      collaboration: record.collaboration || '',
      focus,
      matched: Boolean(record.matched),
      logoPath: storagePath('organisation-logos', record.logo),
      photoPath: storagePath('organisation-photos', record.photo),
      photoAlt: record.photoAlt || '',
      logoBackground: record.logoBackground || '',
      types,
      tools: offerings.tools || [],
      services: offerings.services || [],
      social: record.social || [],
    };
  });

  if (problems.length) {
    throw new Error(`Directory data cannot be seeded:\n- ${problems.join('\n- ')}`);
  }

  const slugs = organisations.map((organisation) => organisation.slug);

  const organisationRows = organisations.map((organisation) =>
    `  (${[
      sqlString(organisation.slug),
      sqlString(organisation.name),
      sqlString(organisation.country),
      sqlString(organisation.region),
      sqlString(organisation.cohort),
      sqlString(organisation.summary),
      sqlString(organisation.description),
      sqlString(organisation.collaboration),
      sqlTextArray(organisation.focus),
      organisation.matched ? 'true' : 'false',
      sqlString(organisation.logoPath),
      sqlString(organisation.photoPath),
      sqlString(organisation.photoAlt),
      sqlString(organisation.logoBackground),
      "'published'",
    ].join(', ')})`,
  );

  const typeRows = organisations.flatMap((organisation) =>
    organisation.types.map((type) => `  (${sqlString(organisation.slug)}, ${sqlString(type)})`),
  );

  const offeringRows = organisations.flatMap((organisation) =>
    ['tools', 'services'].flatMap((kind) =>
      organisation[kind].map((item, index) =>
        `  (${[
          sqlString(organisation.slug),
          kind === 'tools' ? "'tool'" : "'service'",
          sqlString(item.name),
          sqlString(item.description || ''),
          String(index),
        ].join(', ')})`,
      ),
    ),
  );

  const socialRows = organisations.flatMap((organisation) =>
    organisation.social.map((link, index) =>
      `  (${[sqlString(organisation.slug), sqlString(link.type), sqlString(link.url), String(index)].join(', ')})`,
    ),
  );

  const stats = {
    organisations: organisations.length,
    organisationTypes: typeRows.length,
    offerings: offeringRows.length,
    socialLinks: socialRows.length,
    withoutOfferings: organisations.filter(
      (organisation) => !organisation.tools.length && !organisation.services.length,
    ).length,
  };

  const sql = `-- ============================================================================
-- DDISA Grantee Directory — seed data
-- ----------------------------------------------------------------------------
-- GENERATED FILE — do not edit by hand. Regenerate with: npm run build:seed
--
-- Inserts the ${stats.organisations} Cohort 1 organisations from the embedded directory
-- source, plus ${stats.organisationTypes} Type of CSO rows, ${stats.offerings} offerings and ${stats.socialLinks}
-- social links. Safe to re-run: organisations are upserted by slug and the
-- child rows for these organisations are rebuilt from the source of truth
-- (hand-edited profile data for these ${stats.organisations} organisations will be overwritten).
--
-- Logo/photo paths point at the storage buckets; run \`npm run upload:assets\`
-- afterwards so those objects exist, otherwise the profile images will 404.
--
-- Run after supabase/schema.sql. If Supabase reports a missing column, re-run
-- supabase/schema.sql first (it is idempotent), then run this file again.
-- ============================================================================

begin;

-- schema.sql revisions after the original release added logo_background;
-- create it here if the database was set up from an older schema file.
alter table public.organisations
  add column if not exists logo_background text not null default '';

-- 1. Organisations -----------------------------------------------------------
insert into public.organisations (
  slug, name, country, region, cohort, summary, description,
  collaboration, focus_areas, matched, logo_path, photo_path,
  photo_alt, logo_background, publication_status
)
values
${organisationRows.join(',\n')}
on conflict (slug) do update set
  name = excluded.name,
  country = excluded.country,
  region = excluded.region,
  cohort = excluded.cohort,
  summary = excluded.summary,
  description = excluded.description,
  collaboration = excluded.collaboration,
  focus_areas = excluded.focus_areas,
  matched = excluded.matched,
  logo_path = excluded.logo_path,
  photo_path = excluded.photo_path,
  photo_alt = excluded.photo_alt,
  logo_background = excluded.logo_background,
  publication_status = excluded.publication_status,
  updated_at = now();

-- 2. Rebuild child rows for the seeded organisations -------------------------
${childDelete('organisation_types', slugs)}
${childDelete('offerings', slugs)}
${childDelete('social_links', slugs)}

-- 3. Type of CSO -------------------------------------------------------------
${childInsert('organisation_types', ['organisation_id', 'cso_type'], 'v(slug, cso_type)', typeRows)}

-- 4. Offerings ---------------------------------------------------------------
${childInsert('offerings', ['organisation_id', 'kind', 'name', 'description', 'sort_order'], 'v(slug, kind, name, description, sort_order)', offeringRows)}

-- 5. Social / website links --------------------------------------------------
${childInsert('social_links', ['organisation_id', 'platform', 'url', 'sort_order'], 'v(slug, platform, url, sort_order)', socialRows)}

commit;
`;

  return { sql, stats };
}

async function main() {
  const { sql, stats } = buildSeed(root);
  await writeFile(outputPath, sql);
  console.log(`Wrote ${outputPath}`);
  console.log(
    `${stats.organisations} organisations · ${stats.organisationTypes} CSO types · ` +
      `${stats.offerings} offerings · ${stats.socialLinks} social links` +
      (stats.withoutOfferings ? ` · ${stats.withoutOfferings} without offerings` : ''),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
