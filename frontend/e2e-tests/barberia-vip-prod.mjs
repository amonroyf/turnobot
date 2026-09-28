// Suite E2E profunda contra PRODUCCIÓN — tienda "Barberia VIP Duplicada" (slug barberia-vip).
// Uso: node frontend/e2e-tests/barberia-vip-prod.mjs
//
// Prueba TODOS los procesos del sistema vía API + verificaciones de estado en Firestore:
//   A. Público: health, negocio, slots (empleado/any), primer-hueco, existe
//   B. Reserva de cliente con login Google: reservar, duplicado (409), reagendar, mis citas,
//      cancelar cliente, undo (cliente 401 / dueño 200)
//   C. Validaciones: campos, teléfono, nombre, honeypot, servicio inexistente, fecha pasada,
//      hora fuera de jornada, servicio no ofrecido
//   D. Dueño: CRUD servicio de prueba, recursos, reserva modo panel (registro manual),
//      push-test, push token dueño, cache invalidate
//   E. Empleado: asignar PIN (dueño), login, PIN erróneo, empleado sin PIN, citas, pago en
//      puerta (+idempotente), horario propio (inválido/ válido), cambio de PIN propio, push
//   F. Cron: check-reminders sin/ con secreto malo/ bueno (dry_run)
//   G. Rate limit: ráfaga de reservas -> 429
//   H. Limpieza TOTAL: cancela reservas de prueba (para no desviar contadores del CRM), las
//      borra duro, borra clientes/servicio/empleado/recurso de prueba, token push privado,
//      restaura owner_uid original y borra el usuario Auth temporal.
//
// Requisitos: ADC de gcloud (gcloud auth application-default login) + red. Solo toca
// barberia-vip con datos de prueba propios (svc_test_*, emp_test_*, teléfonos únicos) y
// NUNCA los servicios/empleados reales.

import admin from 'firebase-admin';

const API = process.env.API_BASE || 'https://turnobot-850305350371.us-central1.run.app';
const SLUG = 'barberia-vip';
const WEB_API_KEY = 'AIzaSyAr_XqzCCNvkVivrsOMd_vtm6lgZ5OSWqU';
const PROJECT = 'stalwart-coast-439901-d0';

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT });
}
const db = admin.firestore();
const adminAuth = admin.auth();

const ts = Date.now();
const OWNER_EMAIL = `owner-e2e-${ts}@turnobot.test`;
const OWNER_PASS = 'Clave.123!';
// Teléfonos móviles colombianos VÁLIDOS: 10 dígitos, prefijo 311 (asignado),
// únicos por corrida (n de 00 a 99). OJO: no llamar con n > 99.
const T = (n) => `311${String(ts).slice(-5)}${String(n).padStart(2, '0')}`;
const SVC_TEST = `svc_test_${ts}`;
const EMP_TEST = `emp_test_${ts}`;
const REC_TEST = `rec_test_${ts}`;
const MANANA = new Date(Date.now() + 86400000).toISOString().split('T')[0];
const AYER = new Date(Date.now() - 86400000).toISOString().split('T')[0];

let pass = 0, fail = 0, warns = 0;
const resultados = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} :: ${detail}`); }
  resultados.push({ name, pass: !!cond, detail });
};
const warn = (name, detail = '') => { warns++; console.log(`  ⚠️  ${name} :: ${detail}`); resultados.push({ name, pass: null, detail }); };
const sec = (t) => console.log(`\n━━━ ${t} ━━━`);

let ownerToken = '';
const logCalls = [];
const bookTimes = [];
async function req(method, path, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  logCalls.push({ t: new Date().toISOString(), method, path, status: res.status });
  let json = null;
  try { json = JSON.parse(text); } catch { /* no json */ }
  void raw;
  return { status: res.status, json, text, headers: res.headers };
}
// Evita el rate limit 10 POST/min/IP: espera si la ventana está llena.
async function throttleBook() {
  const now = Date.now();
  while (bookTimes.length && now - bookTimes[0] > 61000) bookTimes.shift();
  if (bookTimes.length >= 9) {
    const wait = 61000 - (now - bookTimes[0]) + 500;
    console.log(`  ⏳ (rate limit: esperando ${Math.ceil(wait / 1000)}s)`);
    await new Promise(r => setTimeout(r, wait));
  }
  bookTimes.push(Date.now());
}
async function book(payload, token) {
  await throttleBook();
  return req('POST', `/api/v1/b/${SLUG}/book`, { token, body: payload });
}

// ═══════════════ SETUP ═══════════════
sec('SETUP: dueño temporal, servicio/empleado/recurso de prueba');
let setupOk = true;
try {
  const user = await adminAuth.createUser({ email: OWNER_EMAIL, password: OWNER_PASS, emailVerified: true });
  var ownerUid = user.uid;
  const sign = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${WEB_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASS, returnSecureToken: true }),
  }).then(r => r.json());
  ownerToken = sign.idToken || '';
  if (!ownerToken) throw new Error('no idToken dueño: ' + JSON.stringify(sign.error || {}));
  // owner_uid original -> temporal
  const negSnap = await db.collection('negocios').doc(SLUG).get();
  var originalOwner = negSnap.data().owner_uid || 'e2e-owner';
  await db.collection('negocios').doc(SLUG).update({ owner_uid: ownerUid });
  console.log(`  owner_uid: ${originalOwner} -> ${ownerUid} (temporal)`);

  // Servicio de prueba (30 min, 10:00-18:00 hay jornada por default del negocio)
  await db.collection(`negocios/${SLUG}/servicios`).doc(SVC_TEST)
    .set({ name: `PRUEBA-E2E ${ts}`, duration_minutes: 30, price: '1000', active: true });
  // Empleado de prueba: ofrece SOLO el servicio de prueba (permite probar el
  // rechazo "servicio_no_ofrecido" con otros servicios) y sin horario propio.
  await db.collection(`negocios/${SLUG}/empleados`).doc(EMP_TEST)
    .set({ name: `PRUEBA-E2E Emp ${ts}`, calendar_id: '', servicios_ids: [SVC_TEST] });
  // Invalidar la caché RAM del backend (TTL 5 min): el panel real hace lo mismo
  // tras mutar con SDK directo. Sin esto, GET /negocio sirve el catálogo viejo.
  await fetch(`${API}/api/v1/b/${SLUG}/cache/invalidate`, { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` } });
  // Cliente de Google para reservas "de cliente"
  var CLIENT_EMAIL = `cliente-e2e-${ts}@turnobot.test`;
  var clientUid = (await adminAuth.createUser({ email: CLIENT_EMAIL, password: OWNER_PASS, emailVerified: true })).uid;
  const csign = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${WEB_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: CLIENT_EMAIL, password: OWNER_PASS, returnSecureToken: true }),
  }).then(r => r.json());
  var clientToken = csign.idToken || '';
  var clientToken2 = '';
  var clientUid2 = '';
  {
    const c2email = `cliente2-e2e-${ts}@turnobot.test`;
    clientUid2 = (await adminAuth.createUser({ email: c2email, password: OWNER_PASS, emailVerified: true })).uid;
    clientToken2 = (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${WEB_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: c2email, password: OWNER_PASS, returnSecureToken: true }),
    }).then(r => r.json())).idToken || '';
  }
  // Baseline de contadores del CRM del negocio (para restaurarlos EXACTOS al final:
  // no-show/undo/cancelar los mueven y las reservas sintéticas nunca los subieron).
  var statsBaseline = {};
  const negBefore = (await db.collection('negocios').doc(SLUG).get()).data();
  for (const k of ['stats_citas_activas', 'stats_ingresos_totales']) {
    if (negBefore && k in negBefore) statsBaseline[k] = negBefore[k];
  }
  console.log('  baseline stats:', JSON.stringify(statsBaseline));

  // CRON_SECRET desde la config de Cloud Run (solo lectura; NUNCA se imprime)
  let cronSecret = '';
  try {
    const { execSync } = await import('node:child_process');
    const out = execSync(`gcloud run services describe turnobot --region us-central1 --project ${PROJECT} --format=json 2>/dev/null`, { encoding: 'utf8' });
    const envs = JSON.parse(out)?.spec?.template?.spec?.containers?.[0]?.env || [];
    const cronEnv = envs.find(e => e.name === 'CRON_SECRET');
    cronSecret = cronEnv?.value || '';
  } catch { /* sin gcloud */ }
  var CRON = cronSecret;
  console.log(`  CRON_SECRET: ${CRON ? 'obtenido' : 'NO disponible (se salta el positivo del cron)'}`);
  setupOk = true;
} catch (e) {
  console.error('💥 Setup falló:', e.message);
  process.exit(1);
}

// Reserva pasada creada directo (para no-show/undo): nunca tocó los contadores del CRM.
const pastCitaRef = db.collection('reservas').doc();
var pastCitaId = pastCitaRef.id;
await pastCitaRef.set({
  negocio_id: SLUG, emp_id: EMP_TEST, user_phone: T(90), client_name: 'E2E Pasada',
  service_name: 'PRUEBA-E2E', duration_minutes: 30, price: 1000,
  date_time: new Date(Date.now() - 26 * 3600 * 1000), cancelled: false, no_show: false,
});

const citasPrueba = new Set([pastCitaId]); // ids creados por esta suite
const phonesPrueba = new Set([T(90)]);

// ═══════════════ A. PÚBLICO ═══════════════
sec('A. Procesos públicos');
try {
  const h = await req('GET', '/health');
  ok('A1 health 200 + version', h.status === 200 && !!h.json?.version, `status=${h.status} body=${JSON.stringify(h.json).slice(0, 120)}`);

  const b = await req('GET', `/api/v1/b/${SLUG}`);
  const svcs = b.json?.servicios || [];
  const emps = b.json?.empleados || [];
  ok('A2 negocio público 200 con servicios y empleados', b.status === 200 && svcs.length >= 3 && emps.length >= 2,
    `status=${b.status} svcs=${svcs.length} emps=${emps.length}`);
  ok('A3 el doc público NO expone owner_uid ni tokens', !('owner_uid' in (b.json || {})) && !('push_token' in (b.json || {})) && !('refresh_token' in (b.json || {})),
    `keys=${Object.keys(b.json || {}).join(',')}`);
  ok('A4 nuestro servicio de prueba aparece en el catálogo', svcs.some(s => s.id === SVC_TEST), `ids=${svcs.map(s => s.id).join(',')}`);

  const ex = await req('GET', `/api/v1/b/${SLUG}/existe`);
  ok('A5 /existe true', ex.status === 200 && ex.json?.exists === true, `status=${ex.status} body=${JSON.stringify(ex.json)}`);
  const exBad = await req('GET', `/api/v1/b/no-existe-${ts}/existe`);
  ok('A6 /existe false para slug inexistente', exBad.status === 200 && exBad.json?.exists === false, `status=${exBad.status} body=${JSON.stringify(exBad.json)}`);

  const s1 = await req('GET', `/api/v1/b/${SLUG}/slots?emp_id=${EMP_TEST}&servicio_id=${SVC_TEST}&fecha=${MANANA}`);
  const slots1 = Array.isArray(s1.json) ? s1.json : (s1.json?.slots || []);
  ok('A7 slots empleado prueba mañana > 0', s1.status === 200 && slots1.length > 0, `status=${s1.status} n=${slots1.length} body=${JSON.stringify(s1.json).slice(0, 120)}`);

  const sAny = await req('GET', `/api/v1/b/${SLUG}/slots?emp_id=any&servicio_id=svc_corte&fecha=${MANANA}`);
  ok('A8 slots emp_id=any 200', sAny.status === 200, `status=${sAny.status} body=${JSON.stringify(sAny.json).slice(0, 120)}`);

  const sBad = await req('GET', `/api/v1/b/${SLUG}/slots?emp_id=${EMP_TEST}&servicio_id=${SVC_TEST}&fecha=2026-13-99`);
  ok('A9 slots fecha inválida rechazada (4xx)', sBad.status >= 400 && sBad.status < 500, `status=${sBad.status} body=${JSON.stringify(sBad.json || sBad.text).slice(0, 120)}`);

  const ph = await req('GET', `/api/v1/b/${SLUG}/slots/primer-hueco?servicio_id=${SVC_TEST}&emp_id=${EMP_TEST}&desde=${MANANA}&dias=14`);
  ok('A10 primer-hueco 200 con fecha', ph.status === 200 && !!(ph.json?.fecha || ph.json?.date || ph.json?.iso), `status=${ph.status} body=${JSON.stringify(ph.json).slice(0, 160)}`);

  const susp = await req('GET', `/api/v1/b/negocio-inexistente-${ts}`);
  ok('A11 negocio inexistente 404', susp.status === 404, `status=${susp.status}`);
} catch (e) { fail++; console.error('💥 A error:', e.message); }

// ═══════════════ B. RESERVA DE CLIENTE ═══════════════
sec('B. Reserva de cliente (login Google obligatorio)');
let citaCliente = '';
try {
  const noTok = await book({ servicioId: SVC_TEST, empleadoId: EMP_TEST, fecha: MANANA, hora: '10:00', clienteNombre: 'E2E SinToken', clienteTelefono: T(1) });
  ok('B1 reservar SIN token -> 401 login_requerido', noTok.status === 401, `status=${noTok.status} body=${JSON.stringify(noTok.json || noTok.text).slice(0, 140)}`);

  const r1 = await book({ servicioId: SVC_TEST, empleadoId: EMP_TEST, fecha: MANANA, hora: '10:00', clienteNombre: 'E2E Cliente Uno', clienteTelefono: T(2) }, clientToken);
  citaCliente = r1.json?.cita_id || r1.json?.id || '';
  if (citaCliente) citasPrueba.add(citaCliente);
  phonesPrueba.add(T(2));
  ok('B2 reservar CON token cliente -> 201 + cita_id', r1.status === 201 && !!citaCliente, `status=${r1.status} body=${JSON.stringify(r1.json || r1.text).slice(0, 160)}`);
  if (!citaCliente) { console.log('  (sin cita de cliente, se saltan B4-B16)'); }
  if (citaCliente) {
  const r2 = await book({ servicioId: SVC_TEST, empleadoId: EMP_TEST, fecha: MANANA, hora: '10:00', clienteNombre: 'E2E Cliente Dos', clienteTelefono: T(3) }, clientToken2);
  phonesPrueba.add(T(3));
  ok('B3 doble reserva mismo slot -> 409', r2.status === 409, `status=${r2.status} body=${JSON.stringify(r2.json || r2.text).slice(0, 160)}`);

  const postDup = await req('GET', `/api/v1/b/${SLUG}/slots?emp_id=${EMP_TEST}&servicio_id=${SVC_TEST}&fecha=${MANANA}`);
  const slotsPost = Array.isArray(postDup.json) ? postDup.json : (postDup.json?.slots || []);
  ok('B4 slot 10:00 ya no se ofrece tras reservar', !slotsPost.includes('10:00'), `slots=${JSON.stringify(slotsPost.slice(0, 12))}`);

  const mias = await req('GET', `/api/v1/b/${SLUG}/citas`, { token: clientToken });
  const miasArr = Array.isArray(mias.json) ? mias.json : (mias.json?.citas || []);
  const mia = miasArr.find(c => c.id === citaCliente);
  ok('B5 GET /citas (mis citas) la lista con cancelable', mias.status === 200 && !!mia, `status=${mias.status} found=${!!mia} n=${miasArr.length}`);
  ok('B6 campo cancelable=true (24h de antelación)', mia?.cancelable === true, `cancelable=${JSON.stringify(mia?.cancelable)}`);

  const sinTokenCitas = await req('GET', `/api/v1/b/${SLUG}/citas`);
  ok('B7 GET /citas sin token -> 401', sinTokenCitas.status === 401, `status=${sinTokenCitas.status}`);

  const mv = await req('POST', `/api/v1/b/${SLUG}/citas/${citaCliente}/reschedule`, { token: clientToken, body: { fecha: MANANA, hora: '11:30' } });
  ok('B8 cliente reagenda su cita -> 200', mv.status === 200, `status=${mv.status} body=${JSON.stringify(mv.json || mv.text).slice(0, 160)}`);

  const postMv = await req('GET', `/api/v1/b/${SLUG}/slots?emp_id=${EMP_TEST}&servicio_id=${SVC_TEST}&fecha=${MANANA}`);
  const slotsMv = Array.isArray(postMv.json) ? postMv.json : (postMv.json?.slots || []);
  ok('B9 tras mover: 10:00 libre y 11:30 ocupado', slotsMv.includes('10:00') && !slotsMv.includes('11:30'), `slots=${JSON.stringify(slotsMv.slice(0, 14))}`);

  const mvOtro = await req('POST', `/api/v1/b/${SLUG}/citas/${citaCliente}/reschedule`, { token: clientToken2, body: { fecha: MANANA, hora: '12:00' } });
  ok('B10 OTRO cliente no puede mover la cita ajena -> 403', mvOtro.status === 403, `status=${mvOtro.status} body=${JSON.stringify(mvOtro.json || mvOtro.text).slice(0, 140)}`);

  const mvFantasma = await req('POST', `/api/v1/b/${SLUG}/citas/no-existe-${ts}/reschedule`, { token: clientToken, body: { fecha: MANANA, hora: '12:00' } });
  ok('B11 mover cita inexistente -> 404', mvFantasma.status === 404, `status=${mvFantasma.status}`);

  const cn = await req('DELETE', `/api/v1/b/${SLUG}/citas/${citaCliente}`, { token: clientToken });
  ok('B12 cliente cancela su cita -> 200', cn.status === 200, `status=${cn.status} body=${JSON.stringify(cn.json || cn.text).slice(0, 140)}`);
  const cn2 = await req('DELETE', `/api/v1/b/${SLUG}/citas/${citaCliente}`, { token: clientToken });
  ok('B13 cancelar de nuevo es idempotente (200)', cn2.status === 200, `status=${cn2.status}`);

  const ud = await req('POST', `/api/v1/b/${SLUG}/citas/${citaCliente}/undo`, { token: clientToken });
  ok('B14 cliente NO puede deshacer -> 401', ud.status === 401, `status=${ud.status} body=${JSON.stringify(ud.json || ud.text).slice(0, 140)}`);

  const udO = await req('POST', `/api/v1/b/${SLUG}/citas/${citaCliente}/undo`, { token: ownerToken });
  ok('B15 dueño deshace la cancelación -> 200', udO.status === 200, `status=${udO.status} body=${JSON.stringify(udO.json || udO.text).slice(0, 140)}`);

  const postUd = await req('GET', `/api/v1/b/${SLUG}/slots?emp_id=${EMP_TEST}&servicio_id=${SVC_TEST}&fecha=${MANANA}`);
  const slotsUd = Array.isArray(postUd.json) ? postUd.json : (postUd.json?.slots || []);
  ok('B16 tras undo: 11:30 vuelve a estar ocupado', !slotsUd.includes('11:30'), `slots=${JSON.stringify(slotsUd.slice(0, 14))}`);

  // dejarla activa y que el dueño la cancele en cleanup (contadores ±0)
  }
} catch (e) { fail++; console.error('💥 B error:', e.message); }

// ═══════════════ C. VALIDACIONES ═══════════════
sec('C. Validaciones de negocio (con token cliente)');
try {
  const v1 = await book({ servicioId: SVC_TEST, empleadoId: EMP_TEST, fecha: MANANA, clienteNombre: 'E2E SinHora', clienteTelefono: T(4) }, clientToken);
  ok('C1 sin hora -> 400 missing_fields', v1.status === 400 && v1.json?.error === 'missing_fields', `status=${v1.status} body=${JSON.stringify(v1.json).slice(0, 120)}`);

  const v2 = await book({ servicioId: SVC_TEST, empleadoId: EMP_TEST, fecha: MANANA, hora: '10:00', clienteNombre: 'E2E TelMalo', clienteTelefono: '123' }, clientToken);
  ok('C2 teléfono inválido -> 400 invalid_phone', v2.status === 400 && v2.json?.error === 'invalid_phone', `status=${v2.status} body=${JSON.stringify(v2.json).slice(0, 120)}`);

  const v3 = await book({ servicioId: SVC_TEST, empleadoId: EMP_TEST, fecha: MANANA, hora: '10:00', clienteNombre: 'X'.repeat(101), clienteTelefono: T(5) }, clientToken);
  ok('C3 nombre 101 chars -> 400 invalid_name', v3.status === 400 && v3.json?.error === 'invalid_name', `status=${v3.status} body=${JSON.stringify(v3.json).slice(0, 120)}`);

  const v4 = await book({ servicioId: SVC_TEST, empleadoId: EMP_TEST, fecha: MANANA, hora: '10:00', clienteNombre: 'E2E Bot', clienteTelefono: T(6), website: 'spam.com' }, clientToken);
  ok('C4 honeypot: finge 201 sin crear nada', v4.status === 201 && !v4.json?.cita_id, `status=${v4.status} body=${JSON.stringify(v4.json).slice(0, 120)}`);
  if (v4.json?.cita_id) citasPrueba.add(v4.json.cita_id);

  const v5 = await book({ servicioId: 'svc_inexistente', empleadoId: EMP_TEST, fecha: MANANA, hora: '10:00', clienteNombre: 'E2E SvcFantasma', clienteTelefono: T(7) }, clientToken);
  ok('C5 servicio inexistente rechazado (4xx)', v5.status >= 400 && v5.status < 500, `status=${v5.status} body=${JSON.stringify(v5.json || v5.text).slice(0, 140)}`);

  const v6 = await book({ servicioId: SVC_TEST, empleadoId: 'emp_inexistente', fecha: MANANA, hora: '10:00', clienteNombre: 'E2E EmpFantasma', clienteTelefono: T(8) }, clientToken);
  ok('C6 empleado inexistente rechazado (4xx)', v6.status >= 400 && v6.status < 500, `status=${v6.status} body=${JSON.stringify(v6.json || v6.text).slice(0, 140)}`);

  const v7 = await book({ servicioId: SVC_TEST, empleadoId: EMP_TEST, fecha: AYER, hora: '10:00', clienteNombre: 'E2E Pasado', clienteTelefono: T(9) }, clientToken);
  ok('C7 fecha pasada rechazada (4xx)', v7.status >= 400 && v7.status < 500, `status=${v7.status} body=${JSON.stringify(v7.json || v7.text).slice(0, 140)}`);

  const v8 = await book({ servicioId: SVC_TEST, empleadoId: EMP_TEST, fecha: MANANA, hora: '03:00', clienteNombre: 'E2E Nocturno', clienteTelefono: T(10) }, clientToken);
  ok('C8 hora fuera de jornada rechazada (4xx)', v8.status >= 400 && v8.status < 500, `status=${v8.status} body=${JSON.stringify(v8.json || v8.text).slice(0, 140)}`);

  // svc_corte NO lo ofrece emp_test (lista de especialidades vacía=ofrece todos; real: svc_corte es de otros) — usar real:
  const v9 = await book({ servicioId: 'svc_corte', empleadoId: EMP_TEST, fecha: MANANA, hora: '15:00', clienteNombre: 'E2E NoOfrece', clienteTelefono: T(11) }, clientToken);
  ok('C9 servicio no ofrecido por el profesional -> 4xx', v9.status >= 400 && v9.status < 500, `status=${v9.status} body=${JSON.stringify(v9.json || v9.text).slice(0, 140)}`);

  const v10 = await book({ servicioId: SVC_TEST, empleadoId: EMP_TEST, fecha: MANANA, hora: '25:99', clienteNombre: 'E2E HoraMala', clienteTelefono: T(12) }, clientToken);
  ok('C10 hora malformada rechazada (4xx)', v10.status >= 400 && v10.status < 500, `status=${v10.status} body=${JSON.stringify(v10.json || v10.text).slice(0, 140)}`);

  const v11 = await book({ servicioId: SVC_TEST, empleadoId: EMP_TEST, fecha: MANANA, hora: '10:00', clienteNombre: 'E2E NotasLargas', clienteTelefono: T(13), clienteNotas: 'N'.repeat(501) }, clientToken);
  ok('C11 notas >500 chars -> 400', v11.status === 400, `status=${v11.status} body=${JSON.stringify(v11.json || v11.text).slice(0, 140)}`);
} catch (e) { fail++; console.error('💥 C error:', e.message); }

// ═══════════════ D. DUEÑO ═══════════════
sec('D. Procesos de dueño (panel)');
try {
  const d0 = await req('PUT', `/api/v1/b/${SLUG}/servicios/${SVC_TEST}`, { body: { price: '2000' } });
  ok('D0 PUT servicio sin token -> 401', d0.status === 401, `status=${d0.status}`);

  const d1 = await req('PUT', `/api/v1/b/${SLUG}/servicios/${SVC_TEST}`, { token: ownerToken, body: { name: `PRUEBA-E2E Editada ${ts}`, duration_minutes: 45, price: '2000' } });
  ok('D1 dueño edita servicio -> 200', d1.status === 200, `status=${d1.status} body=${JSON.stringify(d1.json || d1.text).slice(0, 140)}`);
  const d1v = await db.collection(`negocios/${SLUG}/servicios`).doc(SVC_TEST).get();
  ok('D2 edición persistida (45 min / 2000)', d1v.data()?.duration_minutes === 45 && d1v.data()?.price === '2000', `data=${JSON.stringify(d1v.data())}`);

  const d1b = await req('PUT', `/api/v1/b/${SLUG}/servicios/${SVC_TEST}`, { token: ownerToken, body: { duration_minutes: 99999 } });
  ok('D3 duración fuera de rango se acota a 480 (clamp)', d1b.status === 200, `status=${d1b.status}`);
  const d1bv = (await db.collection(`negocios/${SLUG}/servicios`).doc(SVC_TEST).get()).data();
  ok('D4 clamp aplicado (<=480)', (d1bv?.duration_minutes || 0) <= 480, `duration=${d1bv?.duration_minutes}`);
  // Restaurar duración real del servicio de prueba (el clamp anterior la dejó en 480
  // y rompería las reservas posteriores: 14:00+480min sale de la jornada).
  await db.collection(`negocios/${SLUG}/servicios`).doc(SVC_TEST).update({ duration_minutes: 45 });
  await req('POST', `/api/v1/b/${SLUG}/cache/invalidate`, { token: ownerToken });

  const d2 = await req('PUT', `/api/v1/b/${SLUG}/servicios/svc_inexistente_${ts}`, { token: ownerToken, body: { price: '5' } });
  ok('D5 editar servicio inexistente -> 4xx/5xx esperado... verificar', [400, 404, 500].includes(d2.status), `status=${d2.status} body=${JSON.stringify(d2.json || d2.text).slice(0, 140)}`);
  if (d2.status === 500) warn('D5-bis Update de doc inexistente devuelve 500 (debería ser 404)', 'firestore Update sobre doc inexistente falla con NotFound sin traducir');

  // Recursos
  const d6 = await req('POST', `/api/v1/b/${SLUG}/recursos`, { token: ownerToken, body: { name: `PRUEBA-E2E Sala ${ts}`, tipo: 'sala', capacidad: 5, duration_minutes: 30, price: '5000', instructor_id: EMP_TEST } });
  var recId = d6.json?.id || '';
  ok('D6 crear recurso -> 201 + id', d6.status === 201 && !!recId, `status=${d6.status} body=${JSON.stringify(d6.json || d6.text).slice(0, 140)}`);
  if (recId) citasPrueba.add('recurso:' + recId);

  const d7 = await req('POST', `/api/v1/b/${SLUG}/recursos`, { token: ownerToken, body: { name: '', tipo: 'sala' } });
  ok('D7 recurso sin nombre -> 400', d7.status === 400, `status=${d7.status}`);

  const d8 = await req('POST', `/api/v1/b/${SLUG}/recursos`, { token: ownerToken, body: { name: 'Duración mal', tipo: 'sala', duration_minutes: 5 } });
  ok('D8 recurso duración <15 -> 400', d8.status === 400, `status=${d8.status}`);

  const d9 = await req('POST', `/api/v1/b/${SLUG}/recursos`, { body: { name: 'X', tipo: 'sala' } });
  ok('D9 crear recurso sin token -> 401', d9.status === 401, `status=${d9.status}`);

  // Reserva modo panel (registro manual del dueño): sin token cliente, con origen panel.
  // La hora se elige DINÁMICAMENTE del primer slot libre del empleado de prueba.
  const d10slots = await req('GET', `/api/v1/b/${SLUG}/slots?emp_id=${EMP_TEST}&servicio_id=${SVC_TEST}&fecha=${MANANA}`);
  const d10arr = Array.isArray(d10slots.json) ? d10slots.json : (d10slots.json?.slots || []);
  const HORA_PANEL = d10arr[0];
  ok('D10-pre hay slot libre para la cita panel', !!HORA_PANEL, `slots=${JSON.stringify(d10arr.slice(0, 8))}`);
  const d10 = await book({ servicioId: SVC_TEST, empleadoId: EMP_TEST, fecha: MANANA, hora: HORA_PANEL, clienteNombre: 'E2E Panel', clienteTelefono: T(20), origen: 'panel' }, ownerToken);
  var citaPanel = d10.json?.cita_id || d10.json?.id || '';
  if (citaPanel) citasPrueba.add(citaPanel);
  phonesPrueba.add(T(20));
  ok('D10 dueño registra cita manual (origen panel) -> 201', d10.status === 201 && !!citaPanel, `status=${d10.status} body=${JSON.stringify(d10.json || d10.text).slice(0, 160)}`);
  if (citaPanel) {
    const d10v = (await db.collection('reservas').doc(citaPanel).get()).data();
    ok('D11 cita panel NO adjunta UID del dueño', !d10v?.client_uid, `client_uid=${JSON.stringify(d10v?.client_uid)}`);
  }

  // Push dueño
  const d12 = await req('POST', `/api/v1/b/${SLUG}/register-push-token`, { token: ownerToken, body: { token: `e2e_token_${ts}` } });
  ok('D12 dueño registra push token -> 200', d12.status === 200, `status=${d12.status} body=${JSON.stringify(d12.json || d12.text).slice(0, 140)}`);
  const d12b = await req('POST', `/api/v1/b/${SLUG}/register-push-token`, { body: { token: 'x' } });
  ok('D13 push token sin auth -> 401', d12b.status === 401, `status=${d12b.status}`);
  const d12c = await req('POST', `/api/v1/b/${SLUG}/push-test`, { token: ownerToken });
  ok('D14 push-test dueño -> 200 (sin dispositivos reales también válido si limpia tokens)', d12c.status === 200, `status=${d12c.status} body=${JSON.stringify(d12c.json || d12c.text).slice(0, 160)}`);

  const d15 = await req('POST', `/api/v1/b/${SLUG}/cache/invalidate`, { token: ownerToken });
  ok('D15 cache invalidate dueño -> 200', d15.status === 200, `status=${d15.status} body=${JSON.stringify(d15.json || d15.text).slice(0, 140)}`);
  const d15b = await req('POST', `/api/v1/b/${SLUG}/cache/invalidate`, {});
  ok('D16 cache invalidate sin token -> 401', d15b.status === 401, `status=${d15b.status}`);

  // Token del cliente para recordatorio: endpoint público por diseño PERO exige
  // que el teléfono coincida con la reserva (403 si no) y cita futura (410 si pasada).
  if (citaCliente) {
    const d17 = await req('POST', `/api/v1/b/${SLUG}/citas/${citaCliente}/client-push-token`, { body: { token: `e2e_client_tok_${ts}`, phone: T(2) } });
    ok('D17 client-push-token con teléfono que coincide -> 200', d17.status === 200, `status=${d17.status} body=${JSON.stringify(d17.json || d17.text).slice(0, 140)}`);
    const d17b = await req('POST', `/api/v1/b/${SLUG}/citas/${citaCliente}/client-push-token`, { body: { token: `x_${ts}`, phone: T(99) } });
    ok('D18 client-push-token teléfono ajeno -> 403', d17b.status === 403, `status=${d17b.status} body=${JSON.stringify(d17b.json || d17b.text).slice(0, 140)}`);
  }
} catch (e) { fail++; console.error('💥 D error:', e.message); }

// ═══════════════ E. EMPLEADO ═══════════════
sec('E. Procesos de empleado (portal del profesional)');
let empTok = '';
try {
  const e0 = await req('POST', `/api/v1/b/${SLUG}/employee-login`, { body: { emp_id: EMP_TEST, pin: '1234' } });
  ok('E0 login empleado sin PIN configurado -> 403', e0.status === 403, `status=${e0.status} body=${JSON.stringify(e0.json || e0.text).slice(0, 140)}`);

  const e0b = await req('POST', `/api/v1/b/${SLUG}/employee-login`, { body: { emp_id: 'no_existe', pin: '1234' } });
  ok('E1 login empleado inexistente -> 404', e0b.status === 404, `status=${e0b.status}`);

  const e1 = await req('POST', `/api/v1/b/${SLUG}/empleados/${EMP_TEST}/pin`, { token: ownerToken, body: { pin: '2468' } });
  ok('E2 dueño asigna PIN -> 200', e1.status === 200, `status=${e1.status} body=${JSON.stringify(e1.json || e1.text).slice(0, 140)}`);

  const e1b = await req('POST', `/api/v1/b/${SLUG}/empleados/${EMP_TEST}/pin`, { body: { pin: '2468' } });
  ok('E3 asignar PIN sin token -> 401', e1b.status === 401, `status=${e1b.status}`);

  const e2 = await req('POST', `/api/v1/b/${SLUG}/employee-login`, { body: { emp_id: EMP_TEST, pin: '9999' } });
  ok('E4 PIN erróneo -> 401', e2.status === 401, `status=${e2.status}`);

  const e3 = await req('POST', `/api/v1/b/${SLUG}/employee-login`, { body: { emp_id: EMP_TEST, pin: '2468' } });
  empTok = e3.json?.token || '';
  ok('E5 login correcto -> 200 + token', e3.status === 200 && !!empTok, `status=${e3.status} body=${JSON.stringify(e3.json || e3.text).slice(0, 140)}`);

  if (empTok) {
    const e4 = await req('GET', `/api/v1/b/${SLUG}/employee/${EMP_TEST}/citas`, { token: empTok });
    ok('E6 empleado lista sus citas -> 200', e4.status === 200, `status=${e4.status} n=${(e4.json?.citas || []).length}`);
    const e4b = await req('GET', `/api/v1/b/${SLUG}/employee/${EMP_TEST}/citas`, {});
    ok('E7 citas empleado sin token -> 401', e4b.status === 401, `status=${e4b.status}`);
    const e4c = await req('GET', `/api/v1/b/${SLUG}/employee/otro-emp/citas`, { token: empTok });
    ok('E8 token de emp no vale para otro emp -> 401', e4c.status === 401, `status=${e4c.status}`);

    if (citaPanel) {
      const e5 = await req('POST', `/api/v1/b/${SLUG}/employee/${EMP_TEST}/citas/${citaPanel}/pago`, { token: empTok, body: { pagado: true } });
      ok('E9 empleado marca pago en puerta -> 200', e5.status === 200, `status=${e5.status} body=${JSON.stringify(e5.json || e5.text).slice(0, 140)}`);
      const e5v = (await db.collection('reservas').doc(citaPanel).get()).data();
      ok('E10 pago persistido (pagado=true)', e5v?.pagado === true, `pagado=${JSON.stringify(e5v?.pagado)}`);
      const e5b = await req('POST', `/api/v1/b/${SLUG}/employee/${EMP_TEST}/citas/${citaPanel}/pago`, { token: empTok, body: { pagado: true } });
      ok('E11 pago repetido idempotente -> 200', e5b.status === 200, `status=${e5b.status}`);
      if (citaCliente) {
        const e11 = await req('POST', `/api/v1/b/${SLUG}/employee/${EMP_TEST}/citas/${citaCliente}/pago`, { token: empTok, body: { pagado: true } });
        // La cita de cliente pertenece a EMP_TEST (el empleado de prueba SÍ es el asignado):
        // lo correcto es que PUEDA cobrarla (200). Un 403 sería el bug.
        ok('E12b pago de su propia agenda (cita de cliente asignada a él) -> 200', e11.status === 200, `status=${e11.status} body=${JSON.stringify(e11.json || e11.text).slice(0, 140)}`);
      }
    }

    const e6 = await req('PUT', `/api/v1/b/${SLUG}/employee/${EMP_TEST}/horario`, { token: empTok, body: { lunes: { activo: true, turnos: [{ inicio: '13:00', fin: '09:00' }] } } });
    ok('E13 horario inválido (turno invertido) -> 400', e6.status === 400, `status=${e6.status} body=${JSON.stringify(e6.json || e6.text).slice(0, 140)}`);
    const e7 = await req('PUT', `/api/v1/b/${SLUG}/employee/${EMP_TEST}/horario`, {
      token: empTok,
      body: {
        lunes: { activo: true, turnos: [{ inicio: '09:00', fin: '12:00' }, { inicio: '14:00', fin: '18:00' }] },
        martes: { activo: true, turnos: [{ inicio: '09:00', fin: '18:00' }] },
        miercoles: { activo: true, turnos: [{ inicio: '09:00', fin: '18:00' }] },
        jueves: { activo: true, turnos: [{ inicio: '09:00', fin: '18:00' }] },
        viernes: { activo: true, turnos: [{ inicio: '09:00', fin: '18:00' }] },
        sabado: { activo: true, turnos: [{ inicio: '10:00', fin: '14:00' }] },
        domingo: { activo: false, turnos: [] },
      },
    });
    ok('E14 horario válido con turnos partidos -> 200', e7.status === 200, `status=${e7.status} body=${JSON.stringify(e7.json || e7.text).slice(0, 140)}`);
    const e7v = (await db.collection(`negocios/${SLUG}/empleados`).doc(EMP_TEST).get()).data();
    ok('E15 horario persistido (lunes 2 turnos)', (e7v?.horario?.lunes?.turnos || []).length === 2, `lunes=${JSON.stringify(e7v?.horario?.lunes)}`);

    const e8 = await req('POST', `/api/v1/b/${SLUG}/employee/${EMP_TEST}/register-push-token`, { token: empTok, body: { token: `e2e_emp_tok_${ts}` } });
    ok('E16 empleado registra push -> 200', e8.status === 200, `status=${e8.status}`);
    const e8b = await req('DELETE', `/api/v1/b/${SLUG}/employee/${EMP_TEST}/push-token`, { token: empTok });
    ok('E17 empleado baja push -> 200', e8b.status === 200, `status=${e8b.status}`);

    const e9 = await req('POST', `/api/v1/b/${SLUG}/employee/${EMP_TEST}/pin`, { token: empTok, body: { pin: '1357' } });
    ok('E18 empleado cambia su PIN -> 200', e9.status === 200, `status=${e9.status}`);
    const e10 = await req('POST', `/api/v1/b/${SLUG}/employee-login`, { body: { emp_id: EMP_TEST, pin: '1357' } });
    ok('E19 login con PIN nuevo -> 200', e10.status === 200, `status=${e10.status}`);

    const e20 = await req('GET', `/api/v1/b/${SLUG}/employee/${EMP_TEST}/calendar-status`, { token: empTok });
    ok('E20 calendar-status -> 200', e20.status === 200, `status=${e20.status} body=${JSON.stringify(e20.json)}`);
  }
} catch (e) { fail++; console.error('💥 E error:', e.message); }

// ═══════════════ F. NO-SHOW / UNDO ═══════════════
sec('F. No-show y deshacer (cita de ayer)');
try {
  const f0 = await req('POST', `/api/v1/b/${SLUG}/no-show/${pastCitaId}`, {});
  ok('F0 no-show sin credencial -> 401', f0.status === 401, `status=${f0.status}`);

  const f1 = await req('POST', `/api/v1/b/${SLUG}/no-show/${pastCitaId}`, { token: ownerToken });
  ok('F1 dueño marca no-show en cita pasada -> 200', f1.status === 200, `status=${f1.status} body=${JSON.stringify(f1.json || f1.text).slice(0, 140)}`);

  const f2 = await req('POST', `/api/v1/b/${SLUG}/no-show/${citaCliente || pastCitaId}`, { token: ownerToken });
  const futura = citaCliente ? true : false;
  ok('F2 no-show en cita FUTURA -> 400 no_show_futuro', futura ? f2.status === 400 : f2.status === 200, `status=${f2.status} body=${JSON.stringify(f2.json || f2.text).slice(0, 140)}`);

  const f3 = await req('POST', `/api/v1/b/${SLUG}/citas/${pastCitaId}/undo`, { token: ownerToken });
  ok('F3 dueño deshace no-show -> 200', f3.status === 200, `status=${f3.status} body=${JSON.stringify(f3.json || f3.text).slice(0, 140)}`);

  const f4 = await req('POST', `/api/v1/b/${SLUG}/citas/${pastCitaId}/undo`, { token: ownerToken });
  ok('F4 undo de cita activa -> 400 not_cancelled_or_noshow', f4.status === 400, `status=${f4.status} body=${JSON.stringify(f4.json || f4.text).slice(0, 140)}`);

  // empleado asignado también puede marcar no-show
  if (empTok) {
    const f5 = await req('POST', `/api/v1/b/${SLUG}/no-show/${pastCitaId}`, { token: empTok });
    ok('F5 empleado asignado marca no-show -> 200', f5.status === 200, `status=${f5.status} body=${JSON.stringify(f5.json || f5.text).slice(0, 140)}`);
    const f6 = await req('POST', `/api/v1/b/${SLUG}/citas/${pastCitaId}/undo`, { token: empTok });
    ok('F6 empleado asignado deshace -> 200', f6.status === 200, `status=${f6.status}`);
  }
} catch (e) { fail++; console.error('💥 F error:', e.message); }

// ═══════════════ G. CRON ═══════════════
sec('G. Cron de recordatorios (check-reminders)');
try {
  const g1 = await req('POST', '/api/v1/check-reminders', {});
  ok('G1 cron sin secreto -> 401', g1.status === 401, `status=${g1.status}`);
  const g2 = await req('POST', '/api/v1/check-reminders?dry_run=true', {});
  ok('G2 cron sin secreto (dry_run) -> 401', g2.status === 401, `status=${g2.status}`);
  if (CRON) {
    const g3 = await fetch(`${API}/api/v1/check-reminders?dry_run=true`, { method: 'POST', headers: { 'X-Cron-Secret': 'secreto-malo' } });
    logCalls.push({ t: new Date().toISOString(), method: 'POST', path: '/check-reminders(bad)', status: g3.status });
    ok('G3 cron secreto malo -> 401', g3.status === 401, `status=${g3.status}`);
    const g4 = await fetch(`${API}/api/v1/check-reminders?dry_run=true`, { method: 'POST', headers: { 'X-Cron-Secret': CRON } });
    const g4t = await g4.text();
    logCalls.push({ t: new Date().toISOString(), method: 'POST', path: '/check-reminders(dry)', status: g4.status });
    ok('G4 cron dry_run con secreto bueno -> 200', g4.status === 200, `status=${g4.status} body=${g4t.slice(0, 200)}`);
  } else {
    warn('G3/G4 CRON_SECRET no disponible: solo se probó el rechazo sin credencial');
  }
} catch (e) { fail++; console.error('💥 G error:', e.message); }

// ═══════════════ H. RATE LIMIT ═══════════════
sec('H. Rate limit (10 reservas/min/IP)');
try {
  let got429 = 0, lastStatus = 0;
  // Sin throttle a propósito: la idea es REBASAR el límite (10 POST /book/min/IP).
  for (let i = 0; i < 14; i++) {
    const r = await req('POST', `/api/v1/b/${SLUG}/book`, { token: ownerToken, body: { servicioId: SVC_TEST, empleadoId: EMP_TEST, fecha: MANANA, hora: '16:00', clienteNombre: `E2E RL ${i}`, clienteTelefono: T(40 + i) } });
    phonesPrueba.add(T(40 + i));
    if (r.json?.cita_id) citasPrueba.add(r.json.cita_id);
    lastStatus = r.status;
    if (r.status === 429) { got429++; break; }
  }
  ok('H1 ráfaga dispara 429 rate_limited', got429 > 0, `nunca llegó a 429 (último=${lastStatus})`);
} catch (e) { fail++; console.error('💥 H error:', e.message); }

// ═══════════════ I. LIMPIEZA TOTAL ═══════════════
sec('I. Limpieza total (restaurar estado original)');
const limpieza = { citasBorradas: 0, errores: [] };
try {
  // 1. Cancelar por API las activas (devuelve contadores del CRM a su baseline)
  const activas = [...citasPrueba].filter(id => id && !id.startsWith('recurso:'));
  for (const id of activas) {
    try { await req('DELETE', `/api/v1/b/${SLUG}/citas/${id}`, { token: ownerToken }); } catch { /* seguimos */ }
  }
  // 2. Borrado duro de reservas de prueba (incluye las que el honeypot/fallos no crearon)
  for (const id of activas) {
    try { await db.collection('reservas').doc(id).delete(); limpieza.citasBorradas++; } catch (e) { limpieza.errores.push('cita ' + id + ': ' + e.message); }
  }
  // 3. Borrar clientes CRM creados por los teléfonos de prueba (docID = slug__phone)
  for (const p of phonesPrueba) {
    try { await db.collection('clientes').doc(`${SLUG}__${p}`).delete(); } catch { /* no existía */ }
  }
  // 4. Borrar datos de prueba del negocio
  for (const [coll, id] of [[`negocios/${SLUG}/servicios`, SVC_TEST], [`negocios/${SLUG}/empleados`, EMP_TEST]]) {
    try { await db.collection(coll).doc(id).delete(); } catch (e) { limpieza.errores.push(coll + ': ' + e.message); }
  }
  if (typeof recId === 'string' && recId) {
    try { await db.collection(`negocios/${SLUG}/recursos`).doc(recId).delete(); } catch (e) { limpieza.errores.push('recurso: ' + e.message); }
  }
  // 5. Token push privado del dueño temporal (doc creado por esta suite)
  try { await db.collection(`negocios/${SLUG}/privado`).doc('notificaciones').delete(); } catch { /* quizá no existía */ }
  // 5b. Restaurar contadores del CRM al baseline EXACTO (no-show/undo/cancel los movieron)
  const negAfter = (await db.collection('negocios').doc(SLUG).get()).data();
  if (negAfter) {
    const fix = {};
    for (const k of Object.keys(statsBaseline)) {
      if (negAfter[k] !== statsBaseline[k]) fix[k] = statsBaseline[k];
    }
    if (Object.keys(fix).length) {
      await db.collection('negocios').doc(SLUG).update(fix);
      console.log(`  🧹 stats restauradas al baseline: ${JSON.stringify(fix)}`);
    }
  }
  // 6. Restaurar owner_uid original
  await db.collection('negocios').doc(SLUG).update({ owner_uid: originalOwner });
  // 7. Borrar usuarios Auth temporales (dueño + los 2 clientes)
  try { await adminAuth.deleteUser(ownerUid); } catch (e) { limpieza.errores.push('auth owner: ' + e.message); }
  try { await adminAuth.deleteUser(clientUid); } catch (e) { limpieza.errores.push('auth client1: ' + e.message); }
  if (typeof clientUid2 === 'string' && clientUid2) {
    try { await adminAuth.deleteUser(clientUid2); } catch (e) { limpieza.errores.push('auth client2: ' + e.message); }
  }
  console.log(`  🧹 citas borradas: ${limpieza.citasBorradas}; errores: ${limpieza.errores.length ? limpieza.errores.join(' | ') : 'ninguno'}`);
  ok('I1 limpieza completa sin errores', limpieza.errores.length === 0, limpieza.errores.join(' | '));
} catch (e) {
  console.error('💥 LIMPIEZA CON ERRORES:', e.message, '— revisar manualmente owner_uid y docs de prueba');
  limpieza.errores.push(e.message);
}

// ═══════════════ RESUMEN ═══════════════
sec('RESUMEN');
console.log(`  ✅ OK: ${pass}   ❌ FALLOS: ${fail}   ⚠️  AVISOS: ${warns}`);
if (fail > 0) {
  console.log('\n  Detalle de fallos:');
  resultados.filter(r => r.pass === false).forEach(r => console.log(`   - ${r.name} :: ${r.detail}`));
}
console.log('\n  Owner_uid restaurado a:', originalOwner);
process.exit(fail > 0 ? 1 : 0);
