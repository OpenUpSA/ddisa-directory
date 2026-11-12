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
- `server/` — local reference server for API, validation and Supabase Auth session checks.
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
- **`functions/`** — the server-side write flows (grantee sign-in, submissions,
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

## Organisation pages

Every organisation has a standalone, shareable profile page at
`/org/<slug>` — e.g. `/org/digital-woman-uganda`. The cards'
**View full profile** links navigate there on the deployed site, and the
page shows the same profile content as a full page with **Back to
directory**, **Copy link** and (when signed in) **Edit your organisation**
actions.

- Netlify: `netlify.toml` rewrites `/org*` to `index.html` (client-side
  route); the reference server serves the directory HTML for
  `/org/<slug>` directly.
- Old shared modal links (`…#?profile=Name`) redirect to the canonical
  `/org/<slug>` page.
- The self-contained shareable/`file://` build keeps the modal flow, since
  static files have no server routes.
- API, config and asset URLs are root-absolute so they resolve from nested
  `/org/…` paths.

## Run release checks

```bash
npm run qa
```

This validates source syntax, runs all automated tests and rebuilds both
self-contained HTML files.

## Grantee profile editing

Grantees edit their profile by signing in with a Supabase Auth account — no
expiring links, no passwords (email code / magic link):

1. Create a user in Supabase → **Authentication → Users → Add user** (email
   only — no password needed; disable "Auto Confirm" if you want to vet
   sign-ups).
2. Link that user to one organisation:
   `update organisations set owner_id = '<auth-user-uuid>' where slug = '…';`
3. Send the grantee your site URL with `?edit` (e.g.
   `https://ddisa.netlify.app/?edit`) — or they click **Grantee sign in** in
   the directory header.

One-time Supabase Auth setup:

- **Authentication → Email Templates → Magic Link**: include `{{ .Token }}`
  in the template so the email shows a 6-digit code the grantee can type into
  the sign-in dialog (the default template only has a link — clicking that
  works too; both paths are supported).
- **Authentication → URL Configuration**: set *Site URL* to your deployed
  origin (e.g. `https://ddisa.netlify.app`) and add `http://localhost:3000`
  under Redirect URLs for local development — this is where magic links
  send the browser back.

How it holds together:

- The browser requests a one-time code from Supabase GoTrue
  (`POST /auth/v1/otp`) or the grantee clicks the emailed magic link; either
  way the session lands in `localStorage`, refreshing the JWT automatically.
- Every editing request carries `Authorization: Bearer <jwt>`. The site
  validates it via `GET /.netlify/functions/access` and reveals
  **Edit your organisation** for the organisation linked through
  `organisations.owner_id`.
- Publishes flow through `POST /.netlify/functions/submissions`, which
  re-verifies the session, validates every field server-side, uploads images
  to Storage, replaces the profile rows and records an audit row in
  `submissions`.
- **Revoke access** by deleting the user in Supabase → Authentication, or by
  clearing `owner_id`:
  `update organisations set owner_id = null where slug = '…';`
- New organisations (the **Add your organisation** form) and collaboration
  requests stay anonymous — no sign-in required — and go through the same
  functions, rate limited per connection, with the collaboration consent flag
  stored.

Local full-stack testing: `npm start` (reference server, shared submission
code) or `npx netlify dev` to run the real functions (needs netlify-cli).

Not yet connected: e-mailing collaboration notifications, Turnstile bot
protection.

## Current reference implementation

The included Node server mirrors the production write flows — direct
publication in Supabase mode, a local review queue in preview mode — and
verifies grantee sessions against Supabase Auth. It validates Type of CSO,
countries, offerings, contacts, resources, URLs and 5 MB image limits before
anything reaches the database; the Netlify Functions share that exact code
(`server/lib/submissions.mjs`).

The agreed production architecture is Supabase with automatic publication.
The adapter in `server/lib/supabase-store.mjs` implements the contract
described in `DEVELOPER-HANDOFF.md` against the schema in
`supabase/schema.sql`. There is no Docker or NocoDB dependency; the server
runs directly on Node and is intended to move behind Netlify Functions.

## Security

- Keep the service-role key server-side; only the anon key reaches the browser.
- Use HTTPS in production.
- Restrict static serving to the supplied HTML files and `/assets/`.
- Verify Supabase Auth sessions and all submitted fields on the server.
- Add bot protection to public submission endpoints.
- Do not publish `.env`, database exports or storage credentials.
