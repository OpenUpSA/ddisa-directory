# DDISA Directory — QA Report

Test date: 3 November 2026  
Environment: macOS, Node.js 25.9.0, Chrome, desktop 1414 × 823 and mobile
390 × 844  
Release scope: interactive developer prototype, production source, shareable
offline build, reference API and validation

## Result

**Front-end prototype: PASS**  
**Developer handoff: CONDITIONAL PASS**  
**Production deployment: BLOCKED pending Supabase integration**

The supplied directory, profile-viewing, editing, onboarding and collaboration
interfaces passed the checks below. The package is suitable for developer
implementation, but it must not be deployed as the final production system until
the Supabase and notification work listed under “Release blockers” is complete.

## Passed checks

### Data and assets

- 46 directory records loaded.
- All organisation names are unique.
- Every record has a name, country, region, summary, description, focus area and
  logo path.
- No unresolved “Not yet confirmed” focus areas remain in the resolved runtime
  data.
- All 46 logo files exist and are non-empty.
- All 46 logos loaded successfully in the browser.
- The shareable file contains 47 embedded images and no `assets/` references.
- The developer prototype contains the developer-only tools; production and
  shareable builds do not.

### Directory

- Region filters loaded with counts totalling 46.
- Country, focus-area, offering and Type of CSO filters rendered.
- Type of CSO filter returned 33 Women-focused organisations.
- Active filters displayed and cleared correctly.
- Search returned the expected empty state for a non-matching query.
- All 46 profiles opened successfully.
- Every opened profile had the correct title and required content sections.

### Profiles and editing

- Signed edit link opened the matched organisation and displayed the edit action.
- Invalid and tampered edit tokens returned `401` and did not expose the editor.
- Type of CSO options preloaded correctly for an existing organisation.
- Multiple Type of CSO values can be selected.
- Missing Type of CSO produced a clear validation message.
- Existing tools and services loaded in separate groups.
- Tools and services can be added, edited and removed.
- Adding a service updated the card summary from `1 tool · 2 services` to
  `1 tool · 3 services`.
- The published offering also appeared on the profile immediately.
- Email, Number and Other additional-contact fields switched correctly.
- Additional resources could be added and removed.
- Organisation photo and logo limits are 5 MB in client and server validation.
- “Organisation photo” and “Photo description” labels replace all visible
  photograph wording.
- Field tooltips remain inside the viewport on desktop and mobile.

### New organisation

- Country uses a dropdown populated with 40 eligible countries.
- Required Type of CSO field accepts multiple selections.
- Tools/platforms and services/programmes are editable.
- Organisation photo, logo, contacts, resources and collaboration fields are
  present.
- Form labels are associated with controls.
- No duplicate element IDs were found.
- No images without alternative text were found.
- No unnamed buttons or unlabeled form controls were found.

### Responsive and browser checks

- Desktop and mobile layouts had no horizontal page overflow.
- Mobile filters open and close correctly.
- Profile dialogs fit inside the 390 px mobile viewport.
- Developer tools remain visible without covering primary content.
- No browser console errors or warnings were recorded.

### API and security

- `GET /api/health` returned `200` with `no-store` caching.
- `GET /api/directory` returned 46 records, zero pending profiles and zero missing
  logos.
- Invalid edit links returned `401`.
- A tampered edit-link signature returned `401`.
- Unsupported API methods returned `405`.
- Malformed JSON returned `400`.
- A missing Type of CSO returned `400`.
- A country outside the approved list returned `400`.
- Direct requests for `package.json` and `server/index.mjs` returned `404`.
- Approved logo assets remained available with the correct MIME type.
- The dev server bind and access controls were exercised locally.

### Automated checks

- `npm run check`: passed.
- `npm test`: 7 tests passed.
- Source and generated HTML inline-script syntax checks: passed.

## Defects found and fixed during QA

1. The reference server exposed arbitrary repository files, including
   `package.json` and `server/index.mjs`.
   - Fixed with a strict allowlist for the three supplied HTML files and
     `/assets/`.
   - Retested: repository file requests now return `404`.

2. Tooltips were clipped by form and dialog boundaries.
   - Fixed with a viewport-aware tooltip rendered inside the active dialog and
     constrained to the visible viewport.
   - Retested on desktop and mobile.

3. Empty Type of CSO selections could rely only on client behaviour.
   - Added server validation and automated tests.

4. Unsupported countries could be submitted by bypassing the browser dropdown.
   - Added server-side eligible-country validation and a regression test.

5. Offering changes were not reflected immediately on the front card.
   - Publishing now updates the in-memory offering data, directory card summary
     and open profile immediately in the prototype.

## Release blockers for production

These are implementation gaps, not visual defects:

1. **Supabase backend not implemented.** The supplied server uses preview or
   NocoDB storage and does not provide the agreed production Supabase schema,
   RLS, storage buckets or direct-publish transaction.
2. **Automatic email delivery not connected.** New organisations do not
   automatically receive a private edit link, and collaboration requests do not
   send recipient notifications.
3. **Production security review outstanding.** Supabase RLS policies,
   service-role isolation, logging, backups, retention and abuse controls must be
   configured and penetration-tested after deployment.
4. **NocoDB reference workflow is not the final architecture.** The current
   reference server writes review submissions; the agreed production workflow
   publishes validated edits automatically.
5. **Content completion for four researched profiles.** Black Girl Magic,
   Civic-Verse/PoliZ, DailyViz263 and Greenlenszw have verified descriptions but
   no sourced offering records. DailyViz263 and Greenlenszw also still require a
   Type of CSO selection from the grantee.

## Not executable in this environment

- Docker image build and Compose startup were not run because Docker is not
  installed on the QA machine.
- Live Supabase and production authentication tests require the production
  project credentials and were not available.
- Email delivery and collaboration notifications could not be tested because no
  mail provider or notification endpoint is connected.
- The live NocoDB adapter was unit-tested against mocked API responses but was
  not tested against a configured NocoDB instance.

## Handoff acceptance criteria

- All 46 records exist in Supabase with unique organisation IDs.
- Public reads return only published organisations and resources.
- Every organisation has a private edit token that expires and can be revoked.
- Profile edits publish atomically and immediately across descriptions, Type of
  CSO, offerings, contacts, resources, photo and social links.
- New organisation submissions create a record, publish when valid, and email a
  scoped edit link.
- Collaboration requests persist and notify the recipient.
- Image uploads enforce the 5 MB limit in both Supabase policy and server code.
- Automated regression tests run in CI.
- The production deployment passes a fresh desktop/mobile end-to-end test using
  Supabase rather than the preview server.
