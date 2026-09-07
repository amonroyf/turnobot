import { test, expect } from '@playwright/test';
import { db, adminAuth } from './setup.js';

const API = process.env.API_BASE || 'http://localhost:8080';
const WEB_API_KEY = 'AIzaSyAr_XqzCCNvkVivrsOMd_vtm6lgZ5OSWqU';
const ts = Date.now();
const slug = `reglas-${ts}`;
const email = `owner${ts}@turnobot.test`;
const mafana = () => {
  const d = new Date(Date.now() + 86400000);
  return d.toISOString().split('T')[0];
};

let idToken;
let uid;

const crearReserva = async ({ dateTime, extra = {} }) => {
  const ref = await db.collection('reservas').add({
    negocio_id: slug,
    emp_id: 'emp1',
    user_phone: '3100000000',
    client_name: 'Cliente Pruebas',
    service_name: 'Corte',
    duration_minutes: 60,
    date_time: dateTime,
    ...extra,
  });
  return ref.id;
};

test.beforeAll(async () => {
  // Registro vía REST (evita createCustomToken, que exige SA con signBlob).
  const sign = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Clave.123', returnSecureToken: true }),
    },
  ).then((r) => r.json());
  idToken = sign.idToken;
  uid = sign.localId;
  expect(idToken).toBeTruthy();

  await db.collection('negocios').doc(slug).set({
    name: 'Barberia Reglas',
    owner_uid: uid,
    whatsapp: '3100000000',
    direccion: '',
    horario: '',
    telefono: '',
    timezone: 'America/Bogota',
    open_time: '10:00',
    close_time: '14:00',
  });
  await db
    .collection('negocios')
    .doc(slug)
    .collection('servicios')
    .doc('svc1')
    .set({ name: 'Corte', duration_minutes: 60, price: '30000' });
  await db
    .collection('negocios')
    .doc(slug)
    .collection('empleados')
    .doc('emp1')
    .set({ name: 'Sandra', calendar_id: '' });
});

test.afterAll(async () => {
  const reservas = await db
    .collection('reservas')
    .where('negocio_id', '==', slug)
    .get();
  const batch = db.batch();
  reservas.docs.forEach((d) => batch.delete(d.ref));
  const emps = await db.collection(`negocios/${slug}/empleados`).get();
  emps.docs.forEach((d) => batch.delete(d.ref));
  const svcs = await db.collection(`negocios/${slug}/servicios`).get();
  svcs.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  await db.collection('negocios').doc(slug).delete().catch(() => {});
  await adminAuth.deleteUser(uid).catch(() => {});
});

test('1. Slots solo dentro de la jornada operativa 10:00-14:00', async () => {
  const res = await fetch(
    `${API}/api/v1/b/${slug}/slots?emp_id=emp1&servicio_id=svc1&fecha=${mafana()}`,
  );
  expect(res.ok).toBe(true);
  const slots = await res.json();
  expect(slots.length).toBeGreaterThan(0);
  const dentroJornada = slots.every((h) => h >= '10:00' && h < '14:00');
  expect(dentroJornada).toBe(true);
  console.log('SLOTS:', slots.join(','));
});

test('2. Ventana de 2 horas para cancelación del cliente', async () => {
  const en30Min = new Date(Date.now() + 30 * 60 * 1000);
  const manana = new Date(Date.now() + 86400000);

  const cercaId = await crearReserva({ dateTime: en30Min });
  const libreId = await crearReserva({ dateTime: manana });

  // Cliente sin token: menos de 2h -> 403
  const bloqueada = await fetch(`${API}/api/v1/b/${slug}/citas/${cercaId}`, {
    method: 'DELETE',
  });
  expect(bloqueada.status).toBe(403);
  const body = await bloqueada.json();
  expect(body.error).toBe('cancel_window');

  // Cliente sin token: turno de mañana -> permitido
  const permitida = await fetch(`${API}/api/v1/b/${slug}/citas/${libreId}`, {
    method: 'DELETE',
  });
  expect(permitida.status).toBe(200);

  // Dueño con token: puede cancelar incluso a menos de 2h
  const adminOk = await fetch(`${API}/api/v1/b/${slug}/citas/${cercaId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  expect(adminOk.status).toBe(200);

  // Petición maliciosa: token inválido NO debe saltarse la ventana
  const otraCerca = await crearReserva({ dateTime: en30Min });
  const rechazada = await fetch(`${API}/api/v1/b/${slug}/citas/${otraCerca}`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer token-invalido' },
  });
  expect(rechazada.status).toBe(403);
});

test('2b. Límite de una reserva por cliente al día (por teléfono)', async () => {
  const phone = '3200000000';
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
    fetch(`${API}/api/v1/b/${slug}/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  // 1. Primera reserva del día -> 201
  const r1 = await book({ ...payloadBase, hora: '10:00' });
  expect(r1.status).toBe(201);

  // 2. MISMO día y MISMO teléfono (otra hora) -> 409 max_per_day
  const r2 = await book({ ...payloadBase, hora: '11:00' });
  expect(r2.status).toBe(409);
  const b2 = await r2.json();
  expect(b2.error).toBe('max_per_day');
  expect(b2.message).toContain('Ya tienes un turno agendado para este día');

  // 3. OTRO cliente, mismo día -> permitido (la regla es por teléfono)
  const r3 = await book({ ...payloadBase, clienteTelefono: '3200000001', hora: '11:00' });
  expect(r3.status).toBe(201);

  // 4. MISMO cliente, OTRO día -> permitido
  const pasadoManana = new Date(Date.now() + 2 * 86400000);
  const r4 = await book({
    ...payloadBase,
    fecha: pasadoManana.toISOString().split('T')[0],
    hora: '10:00',
  });
  expect(r4.status).toBe(201);
});

test('3. Eliminación en cascada de servicio con citas futuras', async () => {
  const manana = new Date(Date.now() + 86400000);
  const reservaId = await crearReserva({ dateTime: manana });

  const res = await fetch(`${API}/api/v1/b/${slug}/servicios/svc1`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  expect(res.ok).toBe(true);
  const body = await res.json();
  console.log('CASCADA:', JSON.stringify(body));
  expect(body.citas_borradas).toBeGreaterThanOrEqual(1);

  const svcDoc = await db
    .collection('negocios')
    .doc(slug)
    .collection('servicios')
    .doc('svc1')
    .get();
  expect(svcDoc.exists).toBe(false);
  const reservaDoc = await db.collection('reservas').doc(reservaId).get();
  expect(reservaDoc.exists).toBe(false);

  // Sin token de dueño -> 401
  const sinToken = await fetch(`${API}/api/v1/b/${slug}/empleados/emp1`, {
    method: 'DELETE',
  });
  expect(sinToken.status).toBe(401);
});

test('4. Eliminación en cascada de profesional con citas futuras', async () => {
  const manana = new Date(Date.now() + 86400000);
  const reservaId = await crearReserva({ dateTime: manana });

  const res = await fetch(`${API}/api/v1/b/${slug}/empleados/emp1`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  expect(res.ok).toBe(true);

  const empDoc = await db
    .collection('negocios')
    .doc(slug)
    .collection('empleados')
    .doc('emp1')
    .get();
  expect(empDoc.exists).toBe(false);
  const reservaDoc = await db.collection('reservas').doc(reservaId).get();
  expect(reservaDoc.exists).toBe(false);
});