import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { extractDirectoryData } from '../server/lib/directory-data.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const sourcePath = resolve(root, 'DDISA - Grantee Directory.html');
const shareablePath = resolve(root, 'DDISA - Grantee Directory - Shareable.html');
const developerPath = resolve(root, 'DDISA - Developer Prototype.html');

test('directory release data is complete and internally consistent', async () => {
  const { data } = extractDirectoryData(root);
  assert.equal(data.length, 46);
  assert.equal(new Set(data.map((record) => record.name)).size, data.length);

  for (const record of data) {
    assert.ok(record.name, 'Every record needs a name.');
    assert.ok(record.country, `${record.name} needs a country.`);
    assert.ok(record.region, `${record.name} needs a region.`);
    assert.ok(record.summary, `${record.name} needs a card introduction.`);
    assert.ok(record.description, `${record.name} needs a full description.`);
    assert.ok(record.logo, `${record.name} needs a logo path.`);
    assert.ok(!record.focus.includes('Not yet confirmed'), `${record.name} has an unresolved focus area.`);
    const logo = resolve(root, record.logo);
    await access(logo);
    assert.ok((await stat(logo)).size > 0, `${record.logo} must not be empty.`);
  }
});

test('generated HTML artifacts contain the approved release fields', async () => {
  const [source, shareable, developer] = await Promise.all([
    readFile(sourcePath, 'utf8'),
    readFile(shareablePath, 'utf8'),
    readFile(developerPath, 'utf8'),
  ]);

  assert.match(source, /<select id="new-country" required>/);
  assert.doesNotMatch(source, /Profile photograph/i);
  assert.match(source, /smaller than 5 MB/);
  assert.match(source, /Type of CSO/);
  assert.match(source, /What we offer/);
  assert.doesNotMatch(source, /class="developer-tools"/);

  assert.doesNotMatch(shareable, /assets\//);
  assert.doesNotMatch(shareable, /class="developer-tools"/);

  assert.match(developer, /class="developer-tools"/);
  assert.match(developer, /demoPrototype=true/);
});
