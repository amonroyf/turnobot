// Obtiene un ID token del emulador de Firebase Auth para usar en Newman/Postman.
// Uso: FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9098 node tests/api/get-token.mjs
// Imprime el token a stdout (última línea) para capturarlo en shell.
const host = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9098';
const project = process.env.GCP_PROJECT_ID || 'stalwart-coast-439901-d0';
const email = process.env.TEST_EMAIL || 'qa-test@test.com';
const password = 'test1234';

async function call(op, body) {
  const res = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:${op}?key=fake`, {
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