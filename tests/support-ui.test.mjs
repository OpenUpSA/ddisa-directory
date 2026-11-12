import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('support desk page exposes the approved single-page flow', async () => {
  const html = await readFile(resolve(root, 'DDISA - Support Desk.html'), 'utf8');
  assert.match(html, /DDISA Support Desk/);
  assert.match(html, /id="support-form"/);
  assert.match(html, /id="full-name"/);
  assert.match(html, /id="organisation-type"/);
  assert.match(html, /id="support-type"/);
  assert.match(html, /id="goal"/);
  assert.match(html, /id="attachment"/);
  assert.match(html, /id="consent"/);
  assert.match(html, /maximum 25 MB/);
  assert.match(html, /fetch\('\.\/api\/support-requests'/);
  assert.doesNotMatch(html, /WhatsApp/i);
  assert.doesNotMatch(html, /Back to directory|Return to the directory/i);
  assert.doesNotMatch(html, /Do not include passwords, payment card details/i);
});

test('support desk stays separate from the directory interface', async () => {
  const html = await readFile(resolve(root, 'DDISA - Grantee Directory.html'), 'utf8');
  assert.doesNotMatch(html, /DDISA - Support Desk\.html/);
});
