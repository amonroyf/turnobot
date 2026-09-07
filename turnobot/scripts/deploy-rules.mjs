import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const TOKEN = process.env.TOKEN;
const PROJECT = process.env.FIREBASE_PROJECT || 'stalwart-coast-439901-d0';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RULES_FILE = join(ROOT, 'firestore.rules');

if (!TOKEN) {
  console.error('Falta la variable TOKEN (TOKEN=$(gcloud auth print-access-token))');
  process.exit(1);
}

const rules = readFileSync(RULES_FILE, 'utf8');

const res = await fetch(
  `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:commit`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'x-goog-user-project': PROJECT,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      writes: [
        {
          update: {
            createTime: { seconds: '1' },
            updateTime: { seconds: '1' },
            name: 'projects/' + PROJECT + '/databases/(default)/documents/firestore/config',
            fields: {
              firestore_rules: { bytesValue: Buffer.from(rules).toString('base64') },
            },
          },
        },
      ],
    }),
  },
);

const text = await res.text();
if (!res.ok) {
  console.error(`Deploy de reglas -> ${res.status}: ${text.slice(0, 400)}`);
  process.exit(1);
}
console.log('Reglas de Firestore desplegadas OK en', PROJECT);