import { readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourcePath = resolve(root, 'DDISA - Grantee Directory.html');
const outputPath = resolve(root, 'DDISA - Developer Prototype.html');
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
  html = html.split(assetPath).join(`data:${mime};base64,${body.toString('base64')}`);
}

html = html.replace(
  "const editToken=new URLSearchParams(location.search).get('edit')||'';",
  "const demoPrototype=true;\nconst editToken=demoPrototype?'demo-prototype':(new URLSearchParams(location.search).get('edit')||'');",
);
html = html.replace(
  "async function initialiseEditAccess(){\n if(!editToken||!databaseOnline)",
  "async function initialiseEditAccess(){\n if(demoPrototype){editAccess={organisationId:'digital-woman-uganda',organisationName:'Digital Woman Uganda',expiresAt:null};if(activeProfileIndex!==null)openProfile(activeProfileIndex,false);return}\n if(!editToken||!databaseOnline)",
);
html = html.replace(
  "async function hydrateDirectory(){\n if(!databaseOnline){",
  "async function hydrateDirectory(){\n if(demoPrototype){data.forEach(record=>{record.id=record.id||record.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')});$('open-add-organisation').hidden=false;await initialiseEditAccess();return}\n if(!databaseOnline){",
);
html = html.replace(
  "async function postSubmission(payload){\n let response;",
  "async function postSubmission(payload){\n if(demoPrototype){window.__ddisaDemoSubmissions=window.__ddisaDemoSubmissions||[];window.__ddisaDemoSubmissions.push({...payload,submittedAt:new Date().toISOString()});return {ok:true,message:'Your organisation has been published to the directory.',demo:true}}\n let response;",
);

html = html.replace(
  '</style></head><body>',
  `.developer-tools{position:fixed;right:18px;top:50%;transform:translateY(-50%);z-index:80;background:white;border:1px solid #cbd7e5;border-radius:12px;box-shadow:0 10px 30px #06132926;padding:12px}.developer-tools summary{cursor:pointer;color:var(--ink);font-size:11px;font-weight:800;letter-spacing:.3px}.developer-actions{display:grid;gap:7px;margin-top:10px}.developer-actions button{border:1px solid #b9dbd2;background:#edf8f5;color:#195c52;border-radius:7px;padding:8px 10px;font-size:10px;font-weight:800;white-space:nowrap}@media(max-width:560px){.developer-tools{right:10px;top:88px;transform:none}.developer-actions{grid-template-columns:1fr 1fr}.developer-actions button:last-child{grid-column:1/-1}}</style></head><body><details class="developer-tools" aria-label="Developer tools"><summary>Developer tools</summary><div class="developer-actions"><button id="demo-open-editor" type="button">Edit sample profile</button><button id="demo-open-collaboration" type="button">Test collaboration</button><button id="demo-open-new-organisation" type="button">Add organisation</button></div></details>`,
);

html = html.replace(
  'window.addEventListener(\'hashchange\',applyStateFromHash);',
  `$('demo-open-editor').addEventListener('click',()=>{const index=data.findIndex(record=>record.name==='Digital Woman Uganda');if(index>=0){openProfile(index,true);requestAnimationFrame(()=>openProfileEditor())}});
$('demo-open-collaboration').addEventListener('click',()=>{const index=data.findIndex(record=>record.name==='Digital Woman Uganda');if(index>=0){openProfile(index,true);requestAnimationFrame(()=>openCollaborationRequestForm('Digital Woman Uganda'))}});
$('demo-open-new-organisation').addEventListener('click',openOrganisationForm);
window.addEventListener('hashchange',applyStateFromHash);`,
);

await writeFile(outputPath, html);
console.log(`Wrote ${outputPath}`);
console.log(`Embedded ${assetPaths.length} local image assets. Test submissions are available in window.__ddisaDemoSubmissions.`);
