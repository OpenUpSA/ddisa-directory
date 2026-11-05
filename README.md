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

The deploy has two parts:

- **`netlify/`** — the static site: the Grantee Directory front-end with the
  embedded dataset removed, loading published profiles directly from Supabase
  with the anon key.
- **`functions/`** — the server-side write flows (edit links, submissions,
  collaboration requests) running as Netlify Functions with the service-role
  key.

Connect this repository to Netlify (`netlify.toml` builds `netlify/` and
registers `functions/` automatically), then set **Site settings →
Environment variables**:

| Variable | Used by | Purpose |
|---|---|---|
| `SUPABASE_URL` | build + functions | Project URL (Supabase → Settings → API) |
| `SUPABASE_ANON_KEY` | build → `config.js` | Public read key for the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | functions only | Server-side writes; never shipped to the browser |
| `PROFILE_LINK_SECRET` | functions | Verifies signed grantee edit links |

Trigger a deploy so the build injects the anon key into `config.js`. Then run
`npm run upload:assets` once from your machine so the seeded
`logo_path`/`photo_path` values resolve to real objects in Supabase Storage.

(Connecting the repo matters: drag-dropping `netlify/` gives you the read-only
site only — the functions directory lives outside it.)

Row-level security keeps the browser's anon key read-only; every write is
validated inside a Netlify Function before it touches the database.

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

## Grantee profile editing

Grantees edit their profile through a private, expiring link — no accounts:

```bash
PUBLIC_BASE_URL=https://ddisa.netlify.app npm run invite -- "Digital Woman Uganda" 30
```

Or generate **every** organisation's link in one run (mail-merge ready):

```bash
npm run invite:all -- 30
```

That writes `.data/edit-links.csv` — columns: organisation, slug, public_email,
edit_link, expires_at — reading each org's current `token_version` from
Supabase (or the embedded snapshot if Supabase isn't configured). The CSV
contains a live credential for every profile: keep it private, use it for the
mail merge, then delete it (`.data/` is gitignored).

The link is valid for the given number of days and permits edits only for the
named organisation. How it holds together:

- The token is an HMAC signature (keyed by `PROFILE_LINK_SECRET`) over the
  organisation slug, an expiry and the organisation's current `token_version`.
- The site validates it via `GET /.netlify/functions/access` and reveals
  **Edit your organisation**. Publishes flow through
  `POST /.netlify/functions/submissions`, which re-verifies the token,
  validates every field server-side, uploads images to Storage, replaces the
  profile rows and records an audit row in `submissions`.
- **Revoke every outstanding link** for an organisation by bumping one column:
  `update organisations set token_version = token_version + 1 where slug = '…';`
- New organisations (the **Add your organisation** form) and collaboration
  requests go through the same functions — rate limited per connection, with
  the collaboration consent flag stored.

Local full-stack testing: `npm start` (reference server, shared submission
code) or `npx netlify dev` to run the real functions (needs netlify-cli).

Not yet connected: e-mailing edit links automatically, collaboration
notifications, Turnstile bot protection, Supabase Auth.

## Current reference implementation

The included Node server mirrors the production write flows — direct
publication in Supabase mode, a local review queue in preview mode — and
protects grantee edit links with HMAC signatures. It validates Type of CSO,
countries, offerings, contacts, resources, URLs and 5 MB image limits before
anything reaches the database; the Netlify Functions share that exact code
(`server/lib/submissions.mjs`).

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
