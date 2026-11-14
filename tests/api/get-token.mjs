// Obtiene un ID token de Firebase Auth para usar en Newman/Postman.
//
// Emulador:
//   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9098 node tests/api/get-token.mjs
//
// GCP (proyecto de práctica):
//   FIREBASE_API_KEY=... TEST_EMAIL=qa-api@turnobot.test node tests/api/get-token.mjs
//
// Imprime el token a stdout (última línea) para capturarlo en shell.
const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const apiKey = process.env.FIREBASE_API_KEY || 'AIzaSyAr_XqzCCNvkVivrsOMd_vtm6lgZ5OSWqU';
const email = process.env.TEST_EMAIL || 'qa-api@turnobot.test';
const password = process.env.TEST_PASSWORD || 'test1234';

const base = emulatorHost
  ? `http://${emulatorHost}/identitytoolkit.googleapis.com/v1`
  : 'https://identitytoolkit.googleapis.com/v1';
const key = emulatorHost ? 'fake' : apiKey;

async function call(op, body) {
  const res = await fetch(`${base}/accounts:${op}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok && !json.error?.message?.includes('EMAIL_EXISTS')) {
    throw new Error(`${op}: ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

let data = await call('signUp', { email, password, returnSecureToken: true });
if (!data.idToken) {
  data = await call('signInWithPassword', { email, password, returnSecureToken: true });
}
if (!data.idToken) throw new Error('No se obtuvo idToken');
console.log(data.idToken);
