import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Despliegue real de las reglas de Firestore vía firebaserules API:
// crea un ruleset y lo asocia al release cloud.firestore.
// Uso: TOKEN=$(gcloud auth print-access-token) node scripts/deploy-rules.mjs

const TOKEN = process.env.TOKEN;
const PROJECT = process.env.FIREBASE_PROJECT || 'stalwart-coast-439901-d0';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RULES_FILE = join(ROOT, 'firestore.rules');

if (!TOKEN) {
  console.error('Falta la variable TOKEN (TOKEN=$(gcloud auth print-access-token))');
  process.exit(1);
}

const rules = readFileSync(RULES_FILE, 'utf8');
const headers = {
  Authorization: `Bearer ${TOKEN}`,
  'x-goog-user-project': PROJECT,
  'Content-Type': 'application/json',
};

// 1. Crear el ruleset con el contenido de firestore.rules
const rsRes = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: rules }] } }),
});
const rsText = await rsRes.text();
if (!rsRes.ok) {
  console.error(`Crear ruleset -> ${rsRes.status}: ${rsText.slice(0, 400)}`);
  process.exit(1);
}
const rulesetName = JSON.parse(rsText).name;
console.log('Ruleset creado:', rulesetName);

// 2. Asociarlo al release de Firestore (UpdateReleaseRequest)
const relRes = await fetch(
  `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases/cloud.firestore`,
  {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      release: { name: `projects/${PROJECT}/releases/cloud.firestore`, rulesetName },
      updateMask: 'ruleset_name',
    }),
  },
);
const relText = await relRes.text();
if (!relRes.ok) {
  console.error(`Actualizar release -> ${relRes.status}: ${relText.slice(0, 400)}`);
  process.exit(1);
}
console.log('Reglas de Firestore desplegadas OK en', PROJECT);
