-- ============================================================================
-- DDISA Grantee Directory — Supabase schema
-- ----------------------------------------------------------------------------
-- Paste this whole file into the Supabase SQL editor and run it once, or run
-- it with the Supabase CLI against your project. It is idempotent: re-running
-- it will not duplicate data or drop anything.
--
-- After running it:
--   1. Seed the 46 Cohort 1 organisations (migration step, not included here).
--   2. Upload logos/photos into the organisation-logos / organisation-photos
--      buckets and set logo_path / photo_path on each organisation.
--   3. Copy SUPABASE_URL and the service-role key into the server's .env.
--      The service-role key must only ever live on the server.
-- ============================================================================

-- gen_random_uuid() is available by default on Supabase; this makes it explicit.
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. Organisations
-- ----------------------------------------------------------------------------
create table if not exists public.organisations (
  id                uuid primary key default gen_random_uuid(),
  -- Public identifier used in profile URLs and edit access, e.g. "digital-woman-uganda".
  slug              text not null unique
                      check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name              text not null check (char_length(name) between 2 and 180),
  country           text not null check (country in (
                      'Angola','Benin','Botswana','Burkina Faso','Cameroon',
                      'Central African Republic','Chad','Comoros','Côte d''Ivoire',
                      'Democratic Republic of the Congo','Gabon','Gambia','Ghana',
                      'Guinea','Guinea Bissau','Kenya','Lesotho','Liberia',
                      'Madagascar','Malawi','Mali','Mauritania','Mauritius',
                      'Mozambique','Namibia','Niger','Nigeria',
                      'Republic of the Congo','Rwanda','Senegal','Sierra Leone',
                      'Somalia','Somaliland','South Africa','South Sudan',
                      'Tanzania','Togo','Uganda','Zambia','Zimbabwe')),
  region            text not null check (region in (
                      'Southern Africa','Eastern Africa','Central Africa','West Africa')),
  cohort            text not null default 'Cohort 1',
  summary           text not null default '' check (char_length(summary) <= 240),
  description       text not null default '' check (char_length(description) <= 5000),
  collaboration     text not null default '' check (char_length(collaboration) <= 1200),
  public_email      text check (public_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  focus_areas       text[] not null default '{}',
  matched           boolean not null default false,
  -- Object paths in Supabase Storage, e.g. "organisation-logos/logos/<slug>.webp".
  logo_path         text not null default '',
  photo_path        text not null default '',
  photo_alt         text not null default '' check (char_length(photo_alt) <= 180),
  -- Background colour behind the logo card, e.g. "#0b2f2e".
  logo_background   text not null default '',
  publication_status text not null default 'draft'
                      check (publication_status in ('draft', 'pending', 'published', 'archived')),
  -- Supabase Auth user (auth.users.id) allowed to edit this profile.
  -- Null = nobody signed in can edit it yet; set it from the SQL editor with
  --   update organisations set owner_id = '<auth-user-uuid>' where slug = '…';
  owner_id           uuid references auth.users (id) on delete set null,
  last_reviewed     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Keeps databases created before logo backgrounds existed in step with this file.
alter table public.organisations
  add column if not exists logo_background text not null default '';

-- Migration for databases created before Supabase Auth replaced edit links:
-- add the owner column and retire the token revocation counter. These run
-- BEFORE the indexes below, so re-running this file on an existing database
-- works: the create table is skipped there and owner_id does not exist yet
-- until this ALTER adds it. (A fresh create table already includes both.)
alter table public.organisations
  add column if not exists owner_id uuid references auth.users (id) on delete set null;
alter table public.organisations
  drop column if exists token_version;

create index if not exists organisations_publication_status_idx
  on public.organisations (publication_status);
create index if not exists organisations_owner_idx
  on public.organisations (owner_id);
create index if not exists organisations_country_idx on public.organisations (country);
create index if not exists organisations_region_idx on public.organisations (region);

-- ----------------------------------------------------------------------------
-- 2. Type of CSO (one row per organisation and type)
-- ----------------------------------------------------------------------------
create table if not exists public.organisation_types (
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  cso_type        text not null check (cso_type in (
                    'LGBTIQ+ focused','Marginalised communities',
                    'Women-focused','Youth-focused')),
  primary key (organisation_id, cso_type)
);

-- ----------------------------------------------------------------------------
-- 3. Offerings — tools/platforms and services/programmes
-- ----------------------------------------------------------------------------
create table if not exists public.offerings (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  kind              text not null check (kind in ('tool', 'service')),
  name              text not null check (char_length(name) between 1 and 180),
  description       text not null default '' check (char_length(description) <= 800),
  category          text not null default '',
  sort_order        integer not null default 0,
  publication_status text not null default 'published'
                      check (publication_status in ('draft', 'published')),
  created_at        timestamptz not null default now()
);

create index if not exists offerings_organisation_idx
  on public.offerings (organisation_id, kind, sort_order);

-- ----------------------------------------------------------------------------
-- 4. Additional contacts
-- ----------------------------------------------------------------------------
create table if not exists public.contacts (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  type              text not null check (type in ('Email', 'Number', 'Other')),
  name              text not null check (char_length(name) between 1 and 180),
  email             text not null default '',
  number            text not null default '',
  url               text not null default '',
  role              text not null default '',
  description       text not null default '',
  sort_order        integer not null default 0,
  publication_status text not null default 'published'
                      check (publication_status in ('draft', 'published')),
  created_at        timestamptz not null default now(),
  -- Each type only allows its own field to be filled in.
  check (
    (type = 'Email'  and email <> '' and number = '' and url = '') or
    (type = 'Number' and number <> '' and email = '' and url = '') or
    (type = 'Other'  and url <> '' and email = '' and number = '')
  )
);

create index if not exists contacts_organisation_idx
  on public.contacts (organisation_id, sort_order);

-- ----------------------------------------------------------------------------
-- 5. Additional resources
-- ----------------------------------------------------------------------------
create table if not exists public.resources (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  title             text not null check (char_length(title) between 1 and 180),
  url               text not null check (url ~* '^https?://'),
  description       text not null default '' check (char_length(description) <= 800),
  sort_order        integer not null default 0,
  publication_status text not null default 'published'
                      check (publication_status in ('draft', 'published')),
  created_at        timestamptz not null default now()
);

create index if not exists resources_organisation_idx
  on public.resources (organisation_id, sort_order);

-- ----------------------------------------------------------------------------
-- 6. Social / website links
-- ----------------------------------------------------------------------------
create table if not exists public.social_links (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  platform        text not null check (char_length(platform) between 1 and 40),
  url             text not null check (url ~* '^https?://'),
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists social_links_organisation_idx
  on public.social_links (organisation_id, sort_order);

-- ----------------------------------------------------------------------------
-- 7. Review queue — profile updates and new-organisation submissions.
--    The full validated submission is kept in payload (JSONB) so the reviewer
--    view can be built later without changing how submissions arrive.
-- ----------------------------------------------------------------------------
create table if not exists public.submissions (
  id                uuid primary key,
  request_type      text not null check (request_type in ('Profile update', 'New organisation')),
  organisation_slug text,
  organisation_name text not null,
  payload           jsonb not null default '{}'::jsonb,
  photo_path        text not null default '',
  logo_path         text not null default '',
  review_status     text not null default 'Pending'
                      check (review_status in ('Pending', 'Approved', 'Rejected')),
  internal_notes    text not null default '',
  submitted_at      timestamptz not null default now(),
  reviewed_at       timestamptz
);

create index if not exists submissions_status_idx
  on public.submissions (review_status, submitted_at desc);

-- ----------------------------------------------------------------------------
-- 8. Collaboration requests
-- ----------------------------------------------------------------------------
create table if not exists public.collaboration_requests (
  id                   uuid primary key default gen_random_uuid(),
  recipient_organisation text not null check (char_length(recipient_organisation) between 1 and 180),
  sender_organisation  text not null check (char_length(sender_organisation) between 1 and 180),
  sender_name          text not null check (char_length(sender_name) between 1 and 180),
  sender_email         text not null check (sender_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  collaboration_type   text not null check (char_length(collaboration_type) between 1 and 100),
  message              text not null check (char_length(message) between 1 and 2000),
  consent_shared       boolean not null default false,
  status               text not null default 'New'
                         check (status in ('New', 'Notified', 'Closed')),
  created_at           timestamptz not null default now()
);

create index if not exists collaboration_requests_recipient_idx
  on public.collaboration_requests (recipient_organisation, created_at desc);

-- ----------------------------------------------------------------------------
-- 9. updated_at maintenance
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists organisations_set_updated_at on public.organisations;
create trigger organisations_set_updated_at
  before update on public.organisations
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 10. Row Level Security
--     The anon key may only read published directory data. Every write
--     (submissions, collaboration requests, publishing, storage uploads) goes
--     through the server with the service-role key, which bypasses RLS.
--     No insert/update/delete policies are granted to anon or authenticated.
-- ----------------------------------------------------------------------------
alter table public.organisations enable row level security;
alter table public.organisation_types enable row level security;
alter table public.offerings enable row level security;
alter table public.contacts enable row level security;
alter table public.resources enable row level security;
alter table public.social_links enable row level security;
alter table public.submissions enable row level security;
alter table public.collaboration_requests enable row level security;

drop policy if exists "Published organisations are publicly readable" on public.organisations;
create policy "Published organisations are publicly readable"
  on public.organisations for select
  using (publication_status = 'published');

-- Child tables are readable only while their organisation is published.
drop policy if exists "Published organisation types are readable" on public.organisation_types;
create policy "Published organisation types are readable"
  on public.organisation_types for select
  using (exists (
    select 1 from public.organisations o
    where o.id = organisation_id and o.publication_status = 'published'));

drop policy if exists "Published offerings are readable" on public.offerings;
create policy "Published offerings are readable"
  on public.offerings for select
  using (publication_status = 'published' and exists (
    select 1 from public.organisations o
    where o.id = organisation_id and o.publication_status = 'published'));

drop policy if exists "Published contacts are readable" on public.contacts;
create policy "Published contacts are readable"
  on public.contacts for select
  using (publication_status = 'published' and exists (
    select 1 from public.organisations o
    where o.id = organisation_id and o.publication_status = 'published'));

drop policy if exists "Published resources are readable" on public.resources;
create policy "Published resources are readable"
  on public.resources for select
  using (publication_status = 'published' and exists (
    select 1 from public.organisations o
    where o.id = organisation_id and o.publication_status = 'published'));

drop policy if exists "Social links of published organisations are readable" on public.social_links;
create policy "Social links of published organisations are readable"
  on public.social_links for select
  using (exists (
    select 1 from public.organisations o
    where o.id = organisation_id and o.publication_status = 'published'));

-- submissions and collaboration_requests intentionally have no policies:
-- the public can read or write nothing; only the service role reaches them.

-- ----------------------------------------------------------------------------
-- 11. Storage buckets
--     organisation-logos / organisation-photos are public (profile images).
--     submission-uploads is private: reviewers see it through the server.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values
  ('organisation-logos', 'organisation-logos', true),
  ('organisation-photos', 'organisation-photos', true),
  ('submission-uploads', 'submission-uploads', false)
on conflict (id) do nothing;

drop policy if exists "Public logos are readable" on storage.objects;
create policy "Public logos are readable"
  on storage.objects for select
  using (bucket_id in ('organisation-logos', 'organisation-photos'));

-- No insert/update/delete policies for anon/authenticated on any bucket:
-- uploads happen server-side with the service-role key.

-- ----------------------------------------------------------------------------
-- 12. Support Desk — tickets submitted through /support-desk
--     (ported from support-desk/supabase/support_desk.sql). The browser never
--     touches this table: SupportDeskService writes it with the service-role
--     key after validating the request server-side (POST /api/support-requests
--     or the support-requests Netlify function).
-- ----------------------------------------------------------------------------
create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique,
  ticket_id text not null unique,
  submitted_at timestamptz not null default now(),
  full_name text not null check (char_length(full_name) between 1 and 180),
  email text not null check (char_length(email) between 3 and 254),
  organisation text not null check (char_length(organisation) between 1 and 180),
  country text not null check (char_length(country) between 1 and 80),
  organisation_type text not null check (
    organisation_type in ('CBO', 'Women-led', 'Youth-led', 'LGBTIQ+', 'Other')
  ),
  organisation_type_other text not null default '',
  support_type text not null check (
    support_type in ('Technical support', 'Data', 'Grant, payment or admin', 'Other')
  ),
  support_type_other text not null default '',
  goal text not null check (
    goal in ('Report', 'Tool fix or build', 'Data work', 'Learning', 'Other')
  ),
  goal_other text not null default '',
  description text not null check (char_length(description) between 1 and 600),
  tried_so_far text not null default '' check (char_length(tried_so_far) <= 600),
  attachment_path text not null default '',
  attachment_name text not null default '',
  source text not null default 'DDISA web support form',
  status text not null default 'Received',
  trello_card_id text not null default '',
  trello_card_url text not null default '',
  integrations jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organisation_other_required check (
    organisation_type <> 'Other' or char_length(organisation_type_other) > 0
  ),
  constraint support_other_required check (
    support_type <> 'Other' or char_length(support_type_other) > 0
  ),
  constraint goal_other_required check (
    goal <> 'Other' or char_length(goal_other) > 0
  )
);

create index if not exists support_requests_submitted_at_idx
  on public.support_requests (submitted_at desc);

create index if not exists support_requests_status_idx
  on public.support_requests (status);

create index if not exists support_requests_email_idx
  on public.support_requests (lower(email));

drop trigger if exists support_requests_set_updated_at on public.support_requests;
create trigger support_requests_set_updated_at
before update on public.support_requests
for each row execute function public.set_updated_at();

-- The browser never accesses this table directly. The server uses the
-- service-role key, which bypasses RLS after validating the request.
alter table public.support_requests enable row level security;
revoke all on table public.support_requests from anon, authenticated;
grant all on table public.support_requests to service_role;

-- Private bucket for support attachments (25 MB cap, documented MIME types).
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'support-attachments',
  'support-attachments',
  false,
  26214400,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/plain',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- No storage.objects policy is created intentionally: only the server-side
-- service-role key uploads to and reads from this bucket.
