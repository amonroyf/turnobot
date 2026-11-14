import { test, expect } from '@playwright/test';
import { API_BASE, db, adminAuth, e2eSlug } from './setup.js';
import { FIREBASE_API_KEY } from './target.js';
import { telefonoUnico } from './setup.js';

const API = API_BASE;
const WEB_API_KEY = FIREBASE_API_KEY;
const ts = Date.now();
const email = `owner${ts}@turnobot.test`;
const mafana = () => {
  const d = new Date(Date.now() + 86400000);
  return d.toISOString().split('T')[0];
};

const negociosCreados = [];

let idToken;
let uid;
let clienteIdToken;
let clienteUid;
let otroClienteIdToken;
let otroClienteUid;

async function signUpRest(emailToUse) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailToUse, password: 'Clave.123', returnSecureToken: true }),
    },
  ).then((r) => r.json());
  expect(res.idToken).toBeTruthy();
  return res;
}

async function crearNegocioAislado(etiqueta) {
  const testSlug = e2eSlug(`reglas-${etiqueta}-${ts}`);
  await db.collection('negocios').doc(testSlug).set({
    name: `Barbería Reglas ${etiqueta}`,
    owner_uid: uid,
    whatsapp: '3100000000',
    direccion: '',
    horario: '',
    telefono: '3000000000',
    timezone: 'America/Bogota',
    open_time: '10:00',
    close_time: '14:00',
    cancel_window_hours: 24,
  });
  await db
    .collection('negocios')
    .doc(testSlug)
    .collection('servicios')
    .doc('svc1')
    .set({ name: 'Corte', duration_minutes: 60, price: '30000' });
  await db
    .collection('negocios')
    .doc(testSlug)
    .collection('empleados')
    .doc('emp1')
    .set({ name: 'Sandra', calendar_id: '' });
  negociosCreados.push(testSlug);
  return testSlug;
}

async function borrarNegocioAislado(testSlug) {
  const reservas = await db
    .collection('reservas')
    .where('negocio_id', '==', testSlug)
    .get();
  const batch = db.batch();
  reservas.docs.forEach((d) => batch.delete(d.ref));
  const emps = await db.collection(`negocios/${testSlug}/empleados`).get();
  emps.docs.forEach((d) => batch.delete(d.ref));
  const svcs = await db.collection(`negocios/${testSlug}/servicios`).get();
  svcs.docs.forEach((d) => batch.delete(d.ref));
  const clientes = await db
    .collection('clientes')
    .where('negocio_id', '==', testSlug)
    .get();
  clientes.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  await db.collection('negocios').doc(testSlug).delete().catch(() => {});
}

const crearReserva = async ({ negocio: testSlug, dateTime, extra = {} }) => {
  const ref = await db.collection('reservas').add({
    negocio_id: testSlug,
    emp_id: 'emp1',
    user_phone: telefonoUnico(),
    client_name: 'Cliente Pruebas',
    service_name: 'Corte',
    duration_minutes: 60,
    date_time: dateTime,
    client_uid: uid,
    ...extra,
  });
  return ref.id;
};

test.beforeAll(async () => {
  // Registro vía REST (evita createCustomToken, que exige SA con signBlob).
  const sign = await signUpRest(email);
  idToken = sign.idToken;
  uid = sign.localId;

  const signoCliente = await signUpRest(`cliente${ts}@turnobot.test`);
  clienteIdToken = signoCliente.idToken;
  clienteUid = signoCliente.localId;

  const signoOtro = await signUpRest(`otro-cliente${ts}@turnobot.test`);
  otroClienteIdToken = signoOtro.idToken;
  otroClienteUid = signoOtro.localId;
});

test.afterAll(async () => {
  for (const testSlug of new Set(negociosCreados)) {
    await borrarNegocioAislado(testSlug);
  }
  await adminAuth.deleteUser(uid).catch(() => {});
  if (clienteUid) await adminAuth.deleteUser(clienteUid).catch(() => {});
  if (otroClienteUid) await adminAuth.deleteUser(otroClienteUid).catch(() => {});
});

test('1. Slots solo dentro de la jornada operativa 10:00-14:00', async () => {
  const testSlug = await crearNegocioAislado('slots');
  const res = await fetch(
    `${API}/api/v1/b/${testSlug}/slots?emp_id=emp1&servicio_id=svc1&fecha=${mafana()}`,
  );
  expect(res.ok).toBe(true);
  const slots = await res.json();
  expect(slots.length).toBeGreaterThan(0);
  const dentroJornada = slots.every((h) => h >= '10:00' && h < '14:00');
  expect(dentroJornada).toBe(true);
});

test('2. Ventana de cancelación del cliente (default 24h, configurable)', async () => {
  const testSlug = await crearNegocioAislado('ventana');
  const en30Min = new Date(Date.now() + 30 * 60 * 1000);
  const en48h = new Date(Date.now() + 48 * 3600 * 1000);
  const phone = telefonoUnico();

  const cercaId = await crearReserva({
    negocio: testSlug,
    dateTime: en30Min,
    extra: { client_uid: clienteUid, user_phone: phone },
  });
  const libreId = await crearReserva({
    negocio: testSlug,
    dateTime: en48h,
    extra: { client_uid: clienteUid, user_phone: phone },
  });

  // Cliente con su teléfono: menos de 24h -> 409 too_late_to_cancel
  const bloqueada = await fetch(`${API}/api/v1/b/${testSlug}/citas/${cercaId}`, {
    method: 'DELETE',
    headers: { 'X-Client-Phone': phone, Authorization: `Bearer ${clienteIdToken}` },
  });
  expect(bloqueada.status).toBe(409);
  const body = await bloqueada.json();
  expect(body.error).toBe('too_late_to_cancel');

  // Cliente con su teléfono: turno en 48h -> permitido
  const permitida = await fetch(`${API}/api/v1/b/${testSlug}/citas/${libreId}`, {
    method: 'DELETE',
    headers: { 'X-Client-Phone': phone, Authorization: `Bearer ${clienteIdToken}` },
  });
  expect(permitida.status).toBe(200);

  // Dueño con token: puede cancelar incluso dentro de la ventana
  const adminOk = await fetch(`${API}/api/v1/b/${testSlug}/citas/${cercaId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  expect(adminOk.status).toBe(200);

  // Petición maliciosa: token inválido y sin teléfono NO debe cancelar
  const otraCerca = await crearReserva({ negocio: testSlug, dateTime: en30Min });
  const rechazada = await fetch(`${API}/api/v1/b/${testSlug}/citas/${otraCerca}`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer token-invalido' },
  });
  expect(rechazada.status).toBe(403);
});

test('3. Servicio con reservas canceladas se puede eliminar; canceladas se conservan', async () => {
  const testSlug = await crearNegocioAislado('servicio');
  const manana = new Date(Date.now() + 48 * 3600 * 1000);
  const reservaId = await crearReserva({
    negocio: testSlug,
    dateTime: manana,
    extra: { client_uid: clienteUid },
  });

  // El backend rechaza la eliminación de un servicio con citas ACTIVAS.
  // Primero se cancela la reserva para poder probar la cascada.
  const cancel = await fetch(`${API}/api/v1/b/${testSlug}/citas/${reservaId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  expect(cancel.ok).toBe(true);

  const res = await fetch(`${API}/api/v1/b/${testSlug}/servicios/svc1`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  expect(res.ok).toBe(true);
  const body = await res.json();
  expect(body.citas_borradas).toBeGreaterThanOrEqual(0);

  const svcDoc = await db
    .collection('negocios')
    .doc(testSlug)
    .collection('servicios')
    .doc('svc1')
    .get();
  expect(svcDoc.exists).toBe(false);
  const reservaDoc = await db.collection('reservas').doc(reservaId).get();
  expect(reservaDoc.exists).toBe(true); // canceladas no se cascada

  // Sin token de dueño -> 401
  const sinToken = await fetch(`${API}/api/v1/b/${testSlug}/empleados/emp1`, {
    method: 'DELETE',
  });
  expect(sinToken.status).toBe(401);
});

test('4. Profesional con reservas canceladas se puede eliminar; canceladas se conservan', async () => {
  const testSlug = await crearNegocioAislado('empleado');
  const manana = new Date(Date.now() + 48 * 3600 * 1000);
  const reservaId = await crearReserva({
    negocio: testSlug,
    dateTime: manana,
    extra: { client_uid: clienteUid },
  });

  const cancel = await fetch(`${API}/api/v1/b/${testSlug}/citas/${reservaId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  expect(cancel.ok).toBe(true);

  const res = await fetch(`${API}/api/v1/b/${testSlug}/empleados/emp1`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  expect(res.ok).toBe(true);

  const empDoc = await db
    .collection('negocios')
    .doc(testSlug)
    .collection('empleados')
    .doc('emp1')
    .get();
  expect(empDoc.exists).toBe(false);
  const reservaDoc = await db.collection('reservas').doc(reservaId).get();
  expect(reservaDoc.exists).toBe(true); // canceladas no se cascada
});

test('5. Validación estricta de teléfono (libphonenumber + E.164)', async () => {
  const testSlug = await crearNegocioAislado('phone');
  const payloadBase = {
    servicioId: 'svc1',
    empleadoId: 'emp1',
    fecha: mafana(),
    clienteNombre: 'Validador de Teléfonos',
  };

  const bookRequest = (phone, hora) =>
    fetch(`${API}/api/v1/b/${testSlug}/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ ...payloadBase, hora, clienteTelefono: phone }),
    });

  // Escenario A: Número muy corto (imposible en libphonenumber)
  const resCorto = await bookRequest('12345', '16:00');
  expect(resCorto.status).toBe(400);
  const bodyCorto = await resCorto.json();
  expect(bodyCorto.error).toBe('invalid_phone');

  // Escenario B: Número muy largo (imposible en libphonenumber)
  const resLargo = await bookRequest('3001234567899', '16:00');
  expect(resLargo.status).toBe(400);
  const bodyLargo = await resLargo.json();
  expect(bodyLargo.error).toBe('invalid_phone');

  // Escenario C: Patrón "basura" (sin asignación en la región CO)
  const resBasura = await bookRequest('0000000000', '16:00');
  expect(resBasura.status).toBe(400);
  const bodyBasura = await resBasura.json();
  expect(bodyBasura.error).toBe('invalid_phone');
  expect(bodyBasura.message).toContain('no es válido');

  // Escenario D: Número válido con formato (el backend normaliza a E.164)
  const phoneD = `31${Date.now().toString().slice(-8)}`; // único por ejecución
  const phoneDRaw = `(${phoneD.slice(0,3)}) ${phoneD.slice(3,6)}-${phoneD.slice(6)}`;
  const resSaneado = await bookRequest(phoneDRaw, '12:00');
  expect(resSaneado.status).toBe(201);

  // Verificación en Firestore de que se guardó normalizado a E.164 (+57...)
  const checkDb = await db
    .collection('reservas')
    .where('negocio_id', '==', testSlug)
    .where('user_phone', '==', `+57${phoneD}`)
    .get();
  expect(checkDb.empty).toBe(false);
});

test('6. Límite de 3 reservas por cliente al día (por teléfono)', async () => {
  const testSlug = await crearNegocioAislado('limite');
  const phone = telefonoUnico();
  const manana = new Date(Date.now() + 86400000);
  const fecha = manana.toISOString().split('T')[0];
  const payloadBase = {
    servicioId: 'svc1',
    empleadoId: 'emp1',
    fecha,
    clienteNombre: 'Cliente del Día',
    clienteTelefono: phone,
  };
  const book = (body) =>
    fetch(`${API}/api/v1/b/${testSlug}/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clienteIdToken}` },
      body: JSON.stringify(body),
    });

  // 1-3. Tres reservas el mismo día con el mismo teléfono -> 201
  for (const hora of ['10:00', '11:00', '12:00']) {
    const r = await book({ ...payloadBase, hora });
    expect(r.status).toBe(201);
  }

  // 4. Cuarta reserva MISMO día y MISMO teléfono -> 409 max_per_day
  const r4 = await book({ ...payloadBase, hora: '13:00' });
  expect(r4.status).toBe(409);
  const b4 = await r4.json();
  expect(b4.error).toBe('max_per_day');
  expect(b4.message).toContain('Has alcanzado el límite');

  // 5. OTRO cliente, mismo día -> permitido (la regla es por teléfono)
  const r5 = await fetch(`${API}/api/v1/b/${testSlug}/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${otroClienteIdToken}` },
    body: JSON.stringify({ ...payloadBase, clienteTelefono: telefonoUnico(), hora: '13:00' }),
  });
  expect(r5.status).toBe(201);

  // 6. MISMO cliente, OTRO día -> permitido
  const pasadoManana = new Date(Date.now() + 2 * 86400000);
  const r6 = await book({
    ...payloadBase,
    fecha: pasadoManana.toISOString().split('T')[0],
    hora: '10:00',
  });
  expect(r6.status).toBe(201);
});
