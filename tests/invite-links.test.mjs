import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLinksCsv, loadOrganisations } from '../scripts/create-all-profile-links.mjs';
import { verifyProfileToken } from '../server/lib/tokens.mjs';

const SECRET = 'test-secret-with-at-least-32-characters';

// Note: this test file runs with a clean environment (node --test isolates
// files), so loadOrganisations() uses the embedded 46-record fallback.
test('invite:all produces one verifiable edit link per organisation', async () => {
  const organisations = await loadOrganisations();
  assert.equal(organisations.length, 46);

  const csv = buildLinksCsv(organisations, {
    days: 30,
    secret: SECRET,
    baseUrl: 'https://ddisa.netlify.app/',
  });

  const lines = csv.trimEnd().split('\n');
  assert.equal(lines[0], 'organisation,slug,public_email,edit_link,expires_at');
  assert.equal(lines.length, 47, 'header + one row per organisation');

  // Every row carries a link that opens that organisation's profile.
  for (const line of lines.slice(1)) {
    assert.match(line, /\?edit=[A-Za-z0-9_.-]+#directory\?profile=/);
  }

  // Round-trip: extract a token and verify it against the shared verifier.
  const row = lines.find((line) => line.startsWith('Digital Woman Uganda,'));
  assert.ok(row, 'Digital Woman Uganda row must be present');
  const token = row.match(/\?edit=([A-Za-z0-9_.-]+)/)[1];
  const payload = verifyProfileToken(token, SECRET);
  assert.ok(payload, 'token must verify');
  assert.equal(payload.sub, 'digital-woman-uganda');
  assert.equal(payload.v, 1, 'token_version is embedded for revocation');
  assert.ok(payload.exp > Math.floor(Date.now() / 1000) + 29 * 24 * 60 * 60, 'expires in ~30 days');
  assert.match(row, /#directory\?profile=Digital%20Woman%20Uganda/);
});

test('invite:all CSV-escapes organisation names with commas', async () => {
  const csv = buildLinksCsv(
    [
      {
        slug: 'legis360-centre-for-advocacy-development-and-public-enlightenment-initiatives',
        name: 'Legis360 Centre for Advocacy, Development and Public Enlightenment Initiatives',
        version: 2,
        publicEmail: 'hello@example.org',
      },
    ],
    { days: 7, secret: SECRET, baseUrl: 'https://ddisa.netlify.app/' },
  );

  const row = csv.trimEnd().split('\n')[1];
  assert.ok(
    row.startsWith('"Legis360 Centre for Advocacy, Development and Public Enlightenment Initiatives",legis360-'),
    `quoted name expected, got: ${row.slice(0, 80)}`,
  );
  assert.match(row, /,hello@example\.org,/);

  // The embedded version travels into the token so revocation still works.
  const token = row.match(/\?edit=([A-Za-z0-9_.-]+)/)[1];
  const payload = verifyProfileToken(token, SECRET);
  assert.equal(payload.v, 2);
});
