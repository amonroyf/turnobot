import { createHash } from 'node:crypto';
import { createGzip } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOKEN = process.env.TOKEN;
const PROJECT = 'stalwart-coast-439901-d0';
const SITE = process.env.SITE || 'turnobot-web';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = join(ROOT, 'frontend', 'dist');
const ORIGIN = 'https://firebasehosting.googleapis.com/v1beta1';

if (!TOKEN) {
  console.error('Falta la variable TOKEN (gcloud auth print-access-token)');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  'x-goog-user-project': PROJECT,
};

async function api(method, url, { json = null, body = null, ctype = 'application/json' } = {}) {
  const res = await fetch(url, {
    method,
    headers: json != null || body != null ? { ...headers, 'Content-Type': ctype } : headers,
    body: json != null ? JSON.stringify(json) : body,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    throw new Error(`${method} ${url} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  return data;
}

function listFiles(dir, base = dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listFiles(full, base, acc);
    else acc.push(relative(base, full).split(sep).join('/'));
  }
  return acc;
}

const files = listFiles(PUBLIC);
console.log(`files: ${files.length}`);

async function gzipBuffer(raw) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const gz = createGzip({ level: 9 });
    gz.on('data', (c) => chunks.push(c));
    gz.on('end', () => resolve(Buffer.concat(chunks)));
    gz.on('error', reject);
    gz.end(raw);
  });
}

const zipForHash = new Map();
for (const f of files) {
  const raw = readFileSync(join(PUBLIC, f));
  const gz = await gzipBuffer(raw);
  zipForHash.set(f, { hash: createHash('sha256').update(gz).digest('hex'), gz });
}

const populate = {};
for (const [f, v] of zipForHash) populate[`/${f}`] = v.hash;

const version = await api('POST', `${ORIGIN}/projects/-/sites/${SITE}/versions`, { json: { status: 'CREATED', labels: {} } });
const versionName = version.name;
console.log('version:', versionName);

const pop = await api('POST', `${ORIGIN}/${versionName}:populateFiles`, { json: { files: populate } });
console.log('uploadUrl:', pop.uploadUrl);
console.log('hashes en version:  ', (pop.uploadRequiredHashes || []).length);

for (const hash of pop.uploadRequiredHashes || []) {
  const f = [...zipForHash.entries()].find(([, v]) => v.hash === hash);
  if (!f) throw new Error(`no local file for hash ${hash}`);
  await api('POST', `${pop.uploadUrl}/${hash}`, { body: f[1].gz, ctype: 'application/octet-stream' });
  console.log('uploaded', hash.slice(0, 12), f[0]);
}

const config = { rewrites: [{ glob: '**', path: '/index.html' }] };
await api('PATCH', `${ORIGIN}/${versionName}?updateMask=status,config`, {
  json: { status: 'FINALIZED', config },
});
console.log('version FINALIZED');

const release = await api('POST', `${ORIGIN}/projects/-/sites/${SITE}/channels/live/releases?versionName=${versionName}`, { json: {} });
console.log('release:', release.name);
console.log('URL: https://' + SITE + '.web.app');