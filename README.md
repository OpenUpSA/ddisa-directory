# DDISA Grantee Directory

QA-reviewed prototype for the DDISA Cohort 1 grantee directory.

This package is a developer handoff for the reviewed front-end workflows and a
local reference server. It is not yet a production Supabase deployment. See
`DEVELOPER-HANDOFF.md` for the required production work and `QA-REPORT.md` for
the release test results.

## Contents

- `DDISA - Grantee Directory.html` — application source.
- `DDISA - Developer Prototype.html` — self-contained interactive prototype
  with developer shortcuts.
- `DDISA - Grantee Directory - Shareable.html` — self-contained read-only copy
  for offline circulation.
- `assets/` — organisation logos and profile images used by the source build.
- `server/` — local reference server for API, validation and signed edit links.
- `supabase/` — SQL schema, RLS policies and storage buckets for the database.
- `scripts/` — build, seed and private-link utilities.
- `tests/` — automated regression checks.

## Preview locally

Create the local environment file and start the reference server:

```bash
cp .env.example .env
npm start
```

Open <http://localhost:3000>. Preview submissions are written under `.data/`.

## Set up Supabase

1. Run `supabase/schema.sql` in the Supabase SQL editor. It creates the
   tables, RLS policies and storage buckets described in
   `DEVELOPER-HANDOFF.md`.
2. Run `supabase/seed.sql` next. It inserts all 46 Cohort 1 organisations
   with their Type of CSO, offering and social-link rows, and it is safe to
   re-run. The file is generated from the embedded directory source — if the
   HTML data ever changes, regenerate it with `npm run build:seed`.
3. Upload the images: `npm run upload:assets` copies `assets/logos/` and
   `assets/profiles/` into the storage buckets at the exact paths the seed
   writes into `logo_path` / `photo_path` (add `--dry-run` to preview). Until
   this runs, profiles will show broken images instead of the local assets.
4. Copy `.env.example` to `.env`, fill in `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`, and start the server. When both values are
   present the server runs in Supabase mode; otherwise it falls back to local
   preview storage. `DB_MODE` can force either mode.

Keep the service-role key on the server only. RLS allows the public anon key
to read published rows and nothing else.

Supabase Auth is not wired up yet: grantee edit access still uses signed,
expiring links, and authentication can be added on top later.

## Deploy to Netlify

`netlify/` is a self-contained static site: the Grantee Directory front-end
with the embedded dataset removed, loading published profiles directly from
Supabase with the anon key. No server required.

1. Run `npm run build:netlify`. It writes `netlify/index.html` and
   `netlify/config.js` (placeholders unless environment variables are set).
2. Either connect this repository to Netlify (`netlify.toml` builds and
   publishes `netlify/` automatically) or drag-drop the `netlify/` folder.
3. Set the environment variables in **Site settings → Environment variables**
   so the build injects them into `config.js`:
   - `SUPABASE_URL` — project URL from Supabase → Settings → API
   - `SUPABASE_ANON_KEY` — the **anon/public** key (never the service-role key)

   Without a build step you can instead edit `netlify/config.js` by hand.
4. Run `npm run upload:assets` once so the seeded `logo_path`/`photo_path`
   values resolve to real objects in Supabase Storage.

Only published rows are readable from the browser (row-level security);
submissions, edit links and collaboration requests stay disabled until the
Supabase Auth and server-function work lands.

## Build the shareable files

```bash
npm run build:shareable
npm run build:developer-prototype
```

Both builds embed all images so the resulting HTML files can be opened without
the `assets/` directory.

## Run release checks

```bash
npm run qa
```

This validates source syntax, runs all automated tests and rebuilds both
self-contained HTML files.

## Generate a private edit link

```bash
npm run invite -- "Digital Woman Uganda" 30
```

The edit link is valid for a limited number of days and permits edits only for
the named organisation.

## Current reference implementation

The included Node server stores review submissions in Supabase (or locally in
preview mode) and protects grantee edit links with HMAC signatures. It
validates Type of CSO, countries, offerings, contacts, resources, URLs and
5 MB image limits before anything reaches the database.

The agreed production architecture is Supabase with automatic publication.
The adapter in `server/lib/supabase-store.mjs` implements the contract
described in `DEVELOPER-HANDOFF.md` against the schema in
`supabase/schema.sql`. There is no Docker or NocoDB dependency; the server
runs directly on Node and is intended to move behind Netlify Functions.

## Security

- Keep database tokens and `PROFILE_LINK_SECRET` server-side.
- Use HTTPS in production.
- Restrict static serving to the supplied HTML files and `/assets/`.
- Validate signed edit links and all submitted fields on the server.
- Add bot protection to public submission endpoints.
- Do not publish `.env`, database exports or storage credentials.
