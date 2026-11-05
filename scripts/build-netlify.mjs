import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findExpression } from '../server/lib/directory-data.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const htmlPath = 'DDISA - Grantee Directory.html';

// Replaces a whole `signature ... { ... }` block (signature included) with
// `replacement`, failing loudly if the marker is missing from the source.
function replaceBlock(source, signature, replacement) {
  const at = source.indexOf(signature);
  if (at < 0) throw new Error(`Could not find "${signature}" in ${htmlPath}.`);
  const { closing } = findExpression(source, at);
  return source.slice(0, at) + replacement + source.slice(closing + 1);
}

// Replaces a `const x = <expression>` declaration's value only.
function stripDeclaration(source, declaration, emptyValue) {
  const at = source.indexOf(declaration);
  if (at < 0) throw new Error(`Could not find "${declaration}" in ${htmlPath}.`);
  const { closing } = findExpression(source, at);
  return source.slice(0, at) + declaration + emptyValue + source.slice(closing + 1);
}

function requireInclude(source, snippet, label) {
  if (!source.includes(snippet)) {
    throw new Error(`Could not find ${label} in ${htmlPath}; the source layout has changed.`);
  }
  return source;
}

export async function buildNetlify(directoryRoot = root) {
  const source = await readFile(resolve(directoryRoot, htmlPath), 'utf8');
  const runtime = await readFile(resolve(directoryRoot, 'scripts', 'netlify-runtime.js'), 'utf8');

  const grab = (signature) => {
    const at = runtime.indexOf(signature);
    if (at < 0) throw new Error(`Could not find "${signature}" in scripts/netlify-runtime.js.`);
    const { closing } = findExpression(runtime, at);
    return runtime.slice(at, closing + 1);
  };

  let html = source;

  // 1. Remove the embedded dataset — the static build reads Supabase instead.
  html = stripDeclaration(html, 'const data=', '[]');
  html = stripDeclaration(html, 'const researchedProfileUpdates=', '{}');
  html = stripDeclaration(html, 'const offeringsByName=', '{}');

  // 2. Swap the API-backed loader for the direct Supabase client.
  html = replaceBlock(
    html,
    'async function hydrateDirectory',
    `${grab('function mapSupabaseOrganisation')}\n${grab('async function hydrateDirectory')}`,
  );

  // 3. Remove the collaboration request button (no write backend yet).
  html = replaceBlock(html, 'function collaborationMarkup', grab('function collaborationMarkup'));

  // 4. Load config.js (Supabase URL + anon key) before the main script.
  html = requireInclude(html, '<script>\n// Cohort 1 directory.', 'the main script tag');
  html = html.replace(
    '<script>\n// Cohort 1 directory.',
    '<script src="./config.js"></script>\n<script>\n// Cohort 1 directory.',
  );

  // 5. Don't flash "No organisations match these filters" before the data loads.
  html = requireInclude(
    html,
    "$('count').textContent=`Showing ${rows.length} of ${data.length} organisations`;",
    'the result-count line in render()',
  );
  html = html.replace(
    "$('count').textContent=`Showing ${rows.length} of ${data.length} organisations`;",
    "$('count').textContent=data.length?`Showing ${rows.length} of ${data.length} organisations`:'Loading directory…';",
  );
  html = requireInclude(html, "$('empty').hidden=rows.length>0;", 'the empty-state line in render()');
  html = html.replace(
    "$('empty').hidden=rows.length>0;",
    "$('empty').hidden=rows.length>0||!data.length;",
  );

  return html;
}

export function renderConfig(supabaseUrl = '', anonKey = '') {
  const injected = Boolean(supabaseUrl && anonKey);
  const url = injected ? supabaseUrl.replace(/\/+$/, '') : 'https://YOUR-PROJECT.supabase.co';
  const key = injected ? anonKey : 'YOUR-ANON-PUBLIC-KEY';
  return `// Supabase connection for the static DDISA directory.
// ${
    injected
      ? 'Generated from the SUPABASE_URL and SUPABASE_ANON_KEY environment variables at build time.'
      : 'Edit the two values below, or set SUPABASE_URL and SUPABASE_ANON_KEY as environment variables (Netlify > Site settings > Environment variables) and rebuild.'
  }
// Use the anon/public key from Supabase > Settings > API: it is safe to expose
// in the browser because row-level security only allows reading published
// profiles. Never put the service-role key in this file.
window.DDISA_ENV = {
  SUPABASE_URL: ${JSON.stringify(url)},
  SUPABASE_ANON_KEY: ${JSON.stringify(key)}
};
`;
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || '';
  const html = await buildNetlify(root);
  const outputDir = resolve(root, 'netlify');

  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, 'index.html'), html);
  await writeFile(resolve(outputDir, 'config.js'), renderConfig(supabaseUrl, anonKey));

  console.log(`Wrote ${resolve(outputDir, 'index.html')} (${html.length} bytes)`);
  console.log(
    supabaseUrl && anonKey
      ? 'config.js generated from SUPABASE_URL / SUPABASE_ANON_KEY environment variables.'
      : 'config.js written with placeholders — set SUPABASE_URL and SUPABASE_ANON_KEY (env or edit by hand) before deploying.',
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
