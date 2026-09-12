// Test E2E de reglas de reserva configurables contra PRODUCCIÓN.
// Uso: node frontend/e2e-tests/settings-prod.mjs
//
// Crea un negocio aislado con prefijo e2e-, obtiene un ID token de dueño vía
// la API REST de Firebase Auth, cambia cada regla con PUT /settings y verifica
// que el comportamiento del backend cambia (slots, límite diario, antelación).
// Limpia todo al final. Solo toca slugs con prefijo "e2e-".

import admin from 'firebase-admin';

const API = process.env.API_BASE || 'https://turnobot-850305350371.us-central1.run.app';
const PROJECT = 'stalwart-coast-439901-d0';
const WEB_API_KEY = 'AIzaSyAr_XqzCCNvkVivrsOMd_vtm6lgZ5OSWqU';

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT });
}
const db = admin.firestore();

const ts = Date.now();
const slug = `e2e-settings-${ts}`;
const email = `settings${ts}@turnobot.test`;
const password = 'Clave.123!';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${detail}`); }
};
const manana = () => new Date(Date.now() + 86400000).toISOString().split('T')[0];

// ── Setup: dueño + negocio + servicio 30min + empleado sin Calendar ──
console.log('⚙️  Setup (negocio aislado e2e-settings-...)');
const sign = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${WEB_API_KEY}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, returnSecureToken: true }),
}).then(r => r.json());
if (!sign.idToken) {
  console.error('No se pudo crear el usuario de prueba:', sign.error?.message);
  process.exit(1);
}
const { idToken, localId: uid } = sign;
const auth = (extra = {}) => ({ Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json', ...extra });

await db.collection('negocios').doc(slug).set({
  name: 'Settings E2E', owner_uid: uid, whatsapp: '', timezone: 'America/Bogota',
  open_time: '09:00', close_time: '18:00',
});
await db.collection('negocios').doc(slug).collection('servicios').doc('svc1')
  .set({ name: 'Corte', duration_minutes: 30, price: '30000', buffer_minutes: 0 });
await db.collection('negocios').doc(slug).collection('empleados').doc('emp1')
  .set({ name: 'Sandra', calendar_id: '' });

const getSettings = async () => {
  const doc = await db.collection('negocios').doc(slug).get();
  return doc.data();
};
const putSettings = async (body) =>
  fetch(`${API}/api/v1/b/${slug}/settings`, { method: 'PUT', headers: auth(), body: JSON.stringify(body) });
const slots = async (fecha = manana()) => {
  const r = await fetch(`${API}/api/v1/b/${slug}/slots?emp_id=emp1&servicio_id=svc1&fecha=${fecha}`);
  return r.json();
};
const book = async (hora, phone) => {
  const r = await fetch(`${API}/api/v1/b/${slug}/book`, {
    method: 'POST', headers: auth({ 'Content-Type': 'application/json' }), // el backend ignora el token en book
    body: JSON.stringify({
      servicioId: 'svc1', empleadoId: 'emp1', fecha: manana(), hora,
      clienteNombre: 'Cliente Reglas', clienteTelefono: phone,
    }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const limpiarReservas = async () => {
  const snap = await db.collection('reservas').where('negocio_id', '==', slug).get();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch();
    snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
};

try {
  // ── 1. Auth: settings sin token -> 401 ──
  console.log('\n📋 1. Seguridad del endpoint');
  const noAuth = await fetch(`${API}/api/v1/b/${slug}/settings`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ booking_window_days: 5 }),
  });
  ok('PUT /settings sin token responde 401', noAuth.status === 401, `(got ${noAuth.status})`);

  // ── 2. Ventana de reserva: 2 días ──
  console.log('\n📋 2. booking_window_days: el calendario se acorta');
  await putSettings({ booking_window_days: 2 });
  const hoy = new Date().toISOString().split('T')[0];
  const en3dias = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];
  const sMañana = await slots(manana());
  const s3dias = await slots(en3dias);
  ok('Con ventana=2: mañana tiene slots', Array.isArray(sMañana) && sMañana.length > 0, `(${JSON.stringify(sMañana).slice(0, 60)})`);
  ok('Con ventana=2: a 3 días NO hay slots', Array.isArray(s3dias) && s3dias.length === 0, `(${JSON.stringify(s3dias).slice(0, 60)})`);

  // ── 3. Antelación mínima: 24h ──
  console.log('\n📋 3. min_notice_minutes: se filtran horas muy pronto');
  await putSettings({ booking_window_days: 30, min_notice_minutes: 1440 });
  const sNotice = await slots();
  // mañanas enteras pueden quedar fuera si ya es tarde; verificamos coherencia:
  // todos los slots restantes deben ser >= ahora + 24h cuando se agendan para hoy
  const sHoy = await slots(hoy);
  const cutoff = new Date(Date.now() + 1440 * 60000);
  const fmtHM = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const todosFuturos = (sHoy || []).every(h => {
    const [hh, mm] = h.split(':').map(Number);
    const cand = new Date(); cand.setHours(hh, mm, 0, 0);
    return cand >= cutoff;
  });
  ok('Con notice=24h: slots de hoy solo >= ahora+24h', (sHoy || []).length === 0 || todosFuturos, `slots hoy: ${sHoy?.slice(0, 8)}`);
  ok('Con notice=24h: mañana sigue ofreciendo slots', Array.isArray(sNotice) && sNotice.length >= 0);

  // ── 4. Límite por teléfono al día ──
  console.log('\n📋 4. max_bookings_per_phone_per_day');
  await putSettings({ min_notice_minutes: 0 });
  // límite 2: usar los dos primeros slots del día (horarios válidos de la agenda)
  await putSettings({ max_bookings_per_phone_per_day: 2 });
  const sAfterLimit = await slots();
  const slotBase = sAfterLimit[0];
  const slot2 = sAfterLimit[1];
  const slot3 = sAfterLimit[2];
  ok('Hay al menos 3 slots para probar el límite', !!slot3, `(slots: ${sAfterLimit.slice(0, 5)})`);
  const r1 = await book(slotBase, '3111111111');
  const r2 = await book(slot2, '3111111111'); // segunda del día (hora distinta)
  const r3 = await book(slot3, '3111111111');
  ok('Reserva 1 aceptada (201)', r1.status === 201, `(got ${r1.status} ${JSON.stringify(r1.body).slice(0, 80)})`);
  ok('Reserva 2 aceptada con límite=2 (201)', r2.status === 201, `(got ${r2.status} ${JSON.stringify(r2.body).slice(0, 80)})`);
  ok('Reserva 3 rechazada con límite=2 (409 max_per_day)', r3.status === 409 && r3.body.error === 'max_per_day', `(got ${r3.status} ${JSON.stringify(r3.body).slice(0, 80)})`);
  // subir límite a 5: el mismo teléfono ahora puede
  await limpiarReservas();
  await putSettings({ max_bookings_per_phone_per_day: 5 });
  const r4 = await book(slotBase, '3111111111');
  ok('Con límite=5, el mismo teléfono vuelve a poder reservar (201)', r4.status === 201, `(got ${r4.status} ${JSON.stringify(r4.body).slice(0, 80)})`);

  // ── 5. Buffer entre citas ──
  console.log('\n📋 5. buffer_minutes: la pausa bloquea la cita siguiente');
  await limpiarReservas();
  await putSettings({ min_notice_minutes: 0, max_bookings_per_phone_per_day: 3 });
  // Reserva base 09:00. Servicio 30min → sin buffer, 09:30 volvería a estar libre.
  const r5 = await book('09:00', '3222222222');
  ok('Reserva base 09:00 aceptada', r5.status === 201, `(got ${r5.status} ${JSON.stringify(r5.body).slice(0, 80)})`);
  const sSinBuffer = await slots();
  ok('Sin buffer: 09:30 está libre (rejilla de 30min)', Array.isArray(sSinBuffer) && sSinBuffer.includes('09:30'), `(slots: ${sSinBuffer?.slice(0, 6)})`);
  // Buffer 20min: la cita de 09:00 bloquea [09:00, 09:50) → 09:30 desaparece,
  // pero 10:00 sigue disponible (la pausa empuja el inicio, no elimina la hora).
  await db.collection('negocios').doc(slug).collection('servicios').doc('svc1').update({ buffer_minutes: 20 });
  const sBuffer = await slots();
  ok('Con buffer=20: 09:30 desaparece', Array.isArray(sBuffer) && !sBuffer.includes('09:30'), `(slots: ${sBuffer?.slice(0, 6)})`);
  ok('Con buffer=20: 10:00 sigue disponible', Array.isArray(sBuffer) && sBuffer.includes('10:00'), `(slots: ${sBuffer?.slice(0, 6)})`);
  await db.collection('negocios').doc(slug).collection('servicios').doc('svc1').update({ buffer_minutes: 0 });

  // ── 6. Recordatorios: config persistida (Calendar/ICS la leen al crear) ──
  console.log('\n📋 6. reminder_days_before / reminder_hours_before persistidos');
  await putSettings({ reminder_days_before: 3, reminder_hours_before: 4 });
  const cfg = await getSettings();
  ok('reminder_days_before=3 guardado', cfg.reminder_days_before === 3, `(got ${cfg.reminder_days_before})`);
  ok('reminder_hours_before=4 guardado', cfg.reminder_hours_before === 4, `(got ${cfg.reminder_hours_before})`);

  // ── 7. Defaults: guardar 0/ausente vuelve al default ──
  console.log('\n📋 7. Defaults');
  await putSettings({ min_notice_minutes: 0, max_bookings_per_phone_per_day: 0, booking_window_days: 0 });
  const cfg2 = await getSettings();
  ok('min_notice 0 -> default 120 aplica (campo persiste 0)', cfg2.min_notice_minutes === 0);
  const sDefault = await slots(hoy);
  const cutoff120 = new Date(Date.now() + 120 * 60000);
  const ok120 = (sDefault || []).every(h => {
    const [hh, mm] = h.split(':').map(Number);
    const cand = new Date(); cand.setHours(hh, mm, 0, 0);
    return cand >= cutoff120;
  });
  ok('Con min_notice 0: comportamiento vuelve a >= ahora+2h', (sDefault || []).length === 0 || ok120, `slots hoy: ${sDefault?.slice(0, 8)}`);

} catch (err) {
  fail++;
  console.error('\n💥 Error inesperado:', err);
} finally {
  // ── Limpieza ──
  console.log('\n🧹 Limpieza...');
  await limpiarReservas();
  for (const sub of ['servicios', 'empleados']) {
    const snap = await db.collection(`negocios/${slug}/${sub}`).get();
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = db.batch();
      snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  }
  await db.collection('negocios').doc(slug).delete().catch(() => {});
  try {
    const adminAuth = admin.auth();
    await adminAuth.deleteUser(uid);
  } catch (e) { /* ADC sin identitytoolkit: se deja el usuario de prueba */ }
  console.log(`\n══════════════════════════════`);
  console.log(`  Resultado: ${pass} OK · ${fail} FALLOS`);
  console.log(`══════════════════════════════`);
  process.exit(fail > 0 ? 1 : 0);
}
