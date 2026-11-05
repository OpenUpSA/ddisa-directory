import { readdir, readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../server/lib/env.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
loadEnv(root);

const CONTENT_TYPES = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

// Mirrors the paths supabase/seed.sql writes into logo_path / photo_path:
// assets/logos/<file>  -> organisation-logos/logos/<file>
// assets/profiles/<file> -> organisation-photos/profiles/<file>
const TARGETS = [
  { directory: resolve(root, 'assets', 'logos'), bucket: 'organisation-logos', prefix: 'logos' },
  { directory: resolve(root, 'assets', 'profiles'), bucket: 'organisation-photos', prefix: 'profiles' },
];

async function uploadObject(baseUrl, key, bucket, objectPath, buffer, contentType) {
  const response = await fetch(
    `${baseUrl}/storage/v1/object/${bucket}/${encodeURI(objectPath)}`,
    {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': contentType,
        'Cache-Control': 'max-age=31536000',
        'x-upsert': 'true',
      },
      body: buffer,
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status}: ${detail.slice(0, 200)}`);
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const baseUrl = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!dryRun) {
    if (!baseUrl || !key || key.startsWith('replace-')) {
      throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env first.');
    }
  }

  let uploaded = 0;
  let skipped = 0;

  for (const target of TARGETS) {
    const files = (await readdir(target.directory)).filter(
      (file) => CONTENT_TYPES[extname(file).toLowerCase()],
    );

    for (const file of files) {
      const objectPath = `${target.prefix}/${file}`;
      if (dryRun) {
        console.log(`would upload ${target.directory}/${file} -> ${target.bucket}/${objectPath}`);
        uploaded += 1;
        continue;
      }
      try {
        const buffer = await readFile(resolve(target.directory, file));
        await uploadObject(
          baseUrl,
          key,
          target.bucket,
          objectPath,
          buffer,
          CONTENT_TYPES[extname(file).toLowerCase()],
        );
        uploaded += 1;
        console.log(`uploaded ${target.bucket}/${objectPath}`);
      } catch (error) {
        skipped += 1;
        console.error(`FAILED ${target.bucket}/${objectPath}: ${error.message}`);
      }
    }
  }

  console.log(
    dryRun
      ? `${uploaded} files would be uploaded (${skipped} failed).`
      : `${uploaded} files uploaded${skipped ? `, ${skipped} failed` : ''}.`,
  );
  if (skipped) process.exit(1);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
