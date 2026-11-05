import { readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourcePath = resolve(root, 'DDISA - Grantee Directory.html');
const outputPath = resolve(root, 'DDISA - Grantee Directory - Shareable.html');
let html = await readFile(sourcePath, 'utf8');

const mimeByExtension = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const assetPaths = [...new Set(html.match(/assets\/[^"')\s]+/g) || [])];
for (const assetPath of assetPaths) {
  const absolute = resolve(root, assetPath);
  const body = await readFile(absolute);
  const mime = mimeByExtension[extname(absolute).toLowerCase()] || 'application/octet-stream';
  const dataUrl = `data:${mime};base64,${body.toString('base64')}`;
  html = html.split(assetPath).join(dataUrl);
}

await writeFile(outputPath, html);
console.log(`Wrote ${outputPath}`);
console.log(`Embedded ${assetPaths.length} local image assets.`);
