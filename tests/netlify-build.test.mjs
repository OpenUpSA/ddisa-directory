import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(new URL('..', import.meta.url).pathname);

test('netlify build strips the embedded dataset', async () => {
  const html = await readFile(resolve(root, 'netlify', 'index.html'), 'utf8');

  assert.match(html, /const data=\[\];/);
  assert.match(html, /const researchedProfileUpdates=\{\};/);
  assert.match(html, /const offeringsByName=\{\};/);
  assert.doesNotMatch(html, /const data=\[\s*\{/, 'No embedded organisation records may remain.');
  for (const organisation of ['Digital Woman Uganda', 'FactCheckAfrica', 'SafeBangle Technologies']) {
    assert.ok(!html.includes(organisation), `"${organisation}" must not be embedded in the static build.`);
  }
});

test('netlify build connects to Supabase through config.js', async () => {
  const html = await readFile(resolve(root, 'netlify', 'index.html'), 'utf8');

  assert.match(html, /<script src="\.\/config\.js"><\/script>/);
  assert.match(html, /window\.DDISA_ENV/);
  assert.match(html, /\/rest\/v1\/organisations\?select=/);
  assert.match(html, /Bearer \$\{anonKey\}/);
  // Config must load before the main script that reads it.
  assert.ok(
    html.indexOf('src="./config.js"') < html.indexOf('const data=[];'),
    'config.js must load before the main script.',
  );
});

test('netlify build wires write flows to Netlify Functions', async () => {
  const html = await readFile(resolve(root, 'netlify', 'index.html'), 'utf8');

  assert.match(html, /\/\.netlify\/functions\/access\?token=/);
  assert.match(html, /\/\.netlify\/functions\/submissions/);
  assert.match(html, /\/\.netlify\/functions\/collaboration-requests/);
  assert.doesNotMatch(html, /\.\/api\//, 'No reference-server API URLs may remain.');
  // Write UI is live again now that the functions exist.
  assert.match(html, /class="request-collaboration-button"/);
  assert.match(html, /\$\('open-add-organisation'\)\.hidden = false/);
  assert.match(html, /await initialiseEditAccess\(\)/);
  assert.match(html, /consentShared:\$\('collaboration-consent'\)\.checked/);
});

test('netlify config.js carries Supabase connection settings', async () => {
  const config = await readFile(resolve(root, 'netlify', 'config.js'), 'utf8');

  assert.match(config, /window\.DDISA_ENV = \{/);
  assert.match(config, /SUPABASE_URL:/);
  assert.match(config, /SUPABASE_ANON_KEY:/);
  assert.doesNotMatch(config, /service_role|SERVICE_ROLE/i, 'The service-role key must never appear in config.js.');
});
