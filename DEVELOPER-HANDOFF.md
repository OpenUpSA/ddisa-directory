# DDISA Directory — Developer Handoff

## Release status

This package contains the QA-reviewed directory prototype and its reference
server, plus the Supabase production backend: schema + seed, the static
Netlify site, and Netlify Functions for grantee sign-in, submissions and
collaboration requests. Automatic edit-link email delivery and
collaboration-request notifications are not yet connected.

The final product decisions are:

- Deploy the standalone directory and embed it in GitBook.
- Use Supabase for published directory data and organisation submissions.
- Publish approved profile edits automatically after server-side validation.
- Let organisations request collaboration from another organisation's profile.
- Let organisations edit their profile through a passwordless Supabase Auth
  sign-in (email one-time code or magic link) linked via `organisations.owner_id`
  — no shared passwords, no expiring links.

The included Node server is a local reference implementation with a Supabase
adapter. It remains useful for testing validation and sign-in behaviour, but
its review queue is not the target production workflow.

## Files to review

- `DDISA - Grantee Directory.html` — editable application source.
- `DDISA - Developer Prototype.html` — self-contained interactive walkthrough.
- `DDISA - Grantee Directory - Shareable.html` — self-contained read-only copy
  for offline review.
- `QA-REPORT.md` — completed test coverage, fixes and release blockers.

The developer prototype has a floating **Developer tools** menu on the
right-hand side. It opens a sample profile editor, collaboration request and
new-organisation form. Prototype submissions remain in the browser only.

## Directory behaviour

- The directory contains 46 Cohort 1 organisations.
- Every organisation has a logo and complete summary/description.
- Search, sort, region, country, focus-area, offering and Type of CSO filters
  are supported. The four sidebar filters are multi-select checkbox dropdowns:
  values inside one filter are OR-ed, different filters are AND-ed, selections
  live in `filterState` (synced by `syncFilterControl`) and are serialised into
  the share-link hash as comma-separated lists.
- Organisation cards show one short introduction and the counts of tools and
  services.
- Profiles contain the full description, focus areas, offerings, collaboration
  section, contact/social links and Additional Resources.

## Profile editing

Edit access uses an HMAC-signed, expiring token containing the organisation ID.
The link is scoped to one organisation and does not require a grantee account.

The editor supports:

- One or more Type of CSO values.
- Public contact email.
- Additional Email, Number and Other contacts.
- Card introduction and full description.
- Any number of tools/platforms and services/programmes.
- Open for collaboration text.
- Any number of Additional Resources.
- Organisation photo and photo description.

Images accept JPEG, PNG or WebP and are limited to 5 MB per file. The current
reference server validates file size again and does not trust browser checks.

Profile editing requires a Supabase Auth user linked to the organisation
(`organisations.owner_id`). Create the user in Supabase → Authentication
(email only — sign-in is passwordless: emailed one-time code or magic link,
no password set), then link it:

```sql
update organisations set owner_id = '<auth-user-uuid>' where slug = 'digital-woman-uganda';
```

The grantee signs in from the directory (or opens `?edit`): the dialog
requests a code via `POST /auth/v1/otp` and verifies it against
`POST /auth/v1/verify`, or the grantee clicks the magic link and the
redirected session is captured from the URL fragment. The front-end keeps
the session in `localStorage`, sending `Authorization: Bearer <jwt>` on
every editing request. Requires the Magic Link email template to include
`{{ .Token }}` for the code path, and the correct Site URL / Redirect URLs
under Authentication → URL Configuration for the link path.

## New-organisation workflow

The Add your organisation form mirrors the profile editor and includes:

- Required organisation identity and contact fields.
- Country selector populated from the approved eligibility-country list.
- Region, website, Type of CSO and organisation description.
- Tools/platforms, services/programmes, contacts and resources.
- Organisation logo, organisation photo and photo description.

The form rejects missing Type of CSO selections, unsupported countries,
incomplete contacts/resources/offerings, malformed URLs and files over 5 MB.

## Collaboration workflow

Each profile exposes **Request collaboration**. The form records:

- Recipient and sender organisation.
- Sender name and email.
- Collaboration type.
- Proposed collaboration message.
- Consent to share the request with the recipient.

The production implementation must persist the request and notify the recipient
through the agreed email service. No email delivery is connected in the current
reference server.

## Production Supabase contract

The schema, RLS policies and storage buckets below are already implemented in
`supabase/schema.sql`. Apply that file to the Supabase project first, then
extend it if the review workflow changes. `supabase/seed.sql` (generated by
`npm run build:seed` from the embedded directory source) loads the 46
organisations, and `npm run upload:assets` uploads the logo/photo files to the
storage buckets the seed references.

Tables:

- `organisations` — identity, location, cohort, summary, description,
  collaboration text, public email, publication status and photo metadata.
- `organisation_types` — one row per organisation and Type of CSO.
- `offerings` — type (`tool` or `service`), name, description and sort order.
- `contacts` — Email, Number or Other contact records with type-specific fields.
- `resources` — title, URL, description and publication status.
- `social_links` — platform and URL.
- `collaboration_requests` — sender, recipient, message, consent and delivery
  status.
- `submissions` — the review queue: request type, organisation reference,
  the validated payload as JSONB, uploaded image paths and review status.
- `support_requests` — Support Desk tickets from `/support-desk`: contact
  and request fields, attachment metadata, ticket status and the
  `integrations` JSON (Trello-by-email / confirmation email / Slack — both
  emails through the `support-confirmation` Edge Function; Trello forwarding
  uses `TRELLO_BOARD_EMAIL`, no API keys). Written only by
  SupportDeskService with the service-role key.
- `support_admins` — who may use `/support-admin`: the Supabase Auth
  `user_id` plus email. Grant/revoke with the SQL in `supabase/schema.sql`
  section 13; the admin API checks this table after verifying the session.
- `organisations.owner_id` / `owner_email` — the Supabase Auth user (and
  their login email) allowed to edit that profile; set from the
  `/support-admin` console (`link-owner` / `unlink-owner` actions) or SQL.
  Support admins (`support_admins`) can edit **every** organisation
  regardless — the client sends the target `organisationId` and
  `editorFromRequest` resolves it admin-side. Delete the auth user or clear
  the columns to revoke access.

Use Supabase Storage buckets for organisation logos and organisation photos.
Keep bucket and database write operations behind a server function using a
service-role key. Do not expose service-role credentials to the browser.

Public access should be limited to published organisations and published
resources. Editing and collaboration endpoints must verify the Supabase Auth
session and all incoming fields on the server before writing.

## Required production work

Done in this package: the Supabase schema, RLS and buckets
(`supabase/schema.sql`); the 46-record seed and asset upload
(`supabase/seed.sql`, `npm run upload:assets`); Supabase Auth session
validation for organisation editing (`server/lib/auth.mjs` +
`organisations.owner_id`); direct profile and
new-organisation publication with server-side validation and duplicate
checking; and the Netlify deployment (static site + `functions/`).

Remaining:

1. Email delivery: notify collaboration-request recipients (and confirm
   new-organisation sign-ups if Supabase auto-confirm stays off).
2. Retention and deletion handling for collaboration messages (the consent
   flag is captured on submit).
3. Turnstile/CAPTCHA bot protection and durable (cross-instance) rate limits.
4. Optional self-service claiming: let a grantee link their own account to
   their organisation instead of an admin running the SQL update.

## Reference API

The local Node server exposes:

- `GET /api/health`
- `GET /api/directory`
- `GET /api/config` — public Supabase URL + anon key for the sign-in UI
- `GET /api/access` — `Authorization: Bearer <jwt>` → linked organisation
- `POST /api/submissions`
- `POST /api/collaboration-requests`
- `GET /org/<slug>` — standalone organisation profile page; serves the
  directory HTML and lets the front-end render the profile from the path
  (mirrored on Netlify by the `/org*` → `index.html` rewrite in
  `netlify.toml`).
- `POST /api/support-requests` — Support Desk ticket submission (rate
  limited to 6 per hour per connection, 40 MB body for attachments); on
  Netlify rewritten to the `support-requests` function.
- `GET /api/support/health` — Support Desk mode and configured
  integrations.
- `GET|POST /api/support-admin` — admin console API: list tickets and
  organisations with login emails (`GET`, or `?ticket=<id>` for a signed
  attachment URL), status changes and Trello forwarding
  (`POST {action:'status'|'forward', …}`) and organisation login linking
  (`POST {action:'link-owner'|'unlink-owner', organisationSlug, email}`).
  Requires a Supabase Auth session whose user is in `support_admins` (401/403
  otherwise); rewritten to the `support-admin` function on Netlify.

Static serving is restricted to the three supplied HTML files,
`/assets/` and the `/org/<slug>` route. Repository source files are not
publicly served.

## Environment variables

The included reference server expects values in `.env`. Never commit real
secrets.

```dotenv
PORT=3000
DIRECTORY_FILE=DDISA - Grantee Directory.html

# Data mode: "supabase" or "preview". When unset, the server uses "supabase"
# if both values below are set, otherwise "preview".
DB_MODE=supabase
SUPABASE_URL=replace-with-your-supabase-project-url
SUPABASE_SERVICE_ROLE_KEY=replace-with-your-supabase-service-role-key
SUPABASE_ANON_KEY=replace-with-your-supabase-anon-key
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser; it bypasses RLS and
must only live on the server (or in Netlify function environment variables).

On Netlify, set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and
`SUPABASE_ANON_KEY` as site environment variables (the build injects the anon
key into `netlify/config.js`; the functions read all three at runtime). Only
the anon key ever reaches the static site.
