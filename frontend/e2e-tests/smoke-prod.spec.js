import { test, expect } from '@playwright/test';
import { db, adminAuth, crearUsuarioYTema, signInEnPagina } from './setup.js';

const BASE = 'https://turnobot-web.web.app';
const API = 'https://turnobot-850305350371.us-central1.run.app';
const ts = Date.now();
const slug = `e2e-smokeprod${ts}`;
const email = `smoke${ts}@turnobot.test`;
let uid;

test('Smoke prod: registro, catálogo, slots por jornada y eliminación en cascada', async ({
  page,
}) => {
  test.setTimeout(300_000);

  const health = await fetch(`${API}/health`);
  expect(health.ok).toBe(true);
  const body = await health.json();
  expect(body.status).toBe('ok');  const { email: userEmail, password } = await crearUsuarioYTema(email, `Smoke Prod ${ts}`, slug);

  // Login real con el SDK (el negocio ya lo creó crearUsuarioYTema).
  await page.goto(`${BASE}/register`);
  await signInEnPagina(page, userEmail, password);
  await page.goto(`${BASE}/admin`);

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText(`Smoke Prod ${ts}`)).toBeVisible({
    timeout: 30000,
  });

  // El catálogo vive en la vista Ajustes ("Lo que ofreces").
  await page.getByRole('button', { name: 'Ajustes' }).click();
  await page.getByPlaceholder('Ej. Corte, Uñas, Limpieza').fill('Corte Smoke');
  await page.getByPlaceholder('Ej. 30', { exact: true }).fill('60');
  await page.getByPlaceholder('Ej. 20000', { exact: true }).fill('20000');
  await page.getByRole('button', { name: /Agregar Servicio/ }).click();
  await expect(page.getByText('Corte Smoke')).toBeVisible({ timeout: 20000 });

  await page.getByPlaceholder('Ej. Camila, Andrés…').fill('Smoky');
  await page.getByRole('button', { name: '+ Añadir al equipo' }).click();
  await expect(page.getByText('Smoky', { exact: true }).first()).toBeVisible({ timeout: 20000 });
  // Polling: el doc puede tardar ms en estar visible tras el click.
  let empId = '';
  for (let i = 0; i < 10; i++) {
    const q = await db
      .collection('negocios')
      .doc(slug)
      .collection('empleados')
      .where('name', '==', 'Smoky')
      .get();
    if (!q.empty) {
      empId = q.docs[0].id;
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!empId) throw new Error('Smoky no apareció en Firestore tras 20s');
  const empleado = { docs: [{ id: empId }] };
  const servicio = await db
    .collection('negocios')
    .doc(slug)
    .collection('servicios')
    .where('name', '==', 'Corte Smoke')
    .get();
  const svcId = servicio.docs[0].id;

  const manana = new Date(Date.now() + 86400000);
  const fecha = manana.toISOString().split('T')[0];
  const slotsRes = await fetch(
    `${API}/api/v1/b/${slug}/slots?emp_id=${empId}&servicio_id=${svcId}&fecha=${fecha}`,
  );
  expect(slotsRes.ok).toBe(true);
  const slots = await slotsRes.json();
  expect(slots.length).toBeGreaterThan(0);
  expect(slots.every((h) => h >= '09:00' && h < '18:00')).toBe(true);

  // Book exige login (401 sin token): idToken del dueño sirve como cliente.
  const idToken = await page.evaluate(async () => {
    const { initializeApp, getApps, getApp } = await import(
      'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'
    );
    const { getAuth } = await import(
      'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'
    );
    const cfg = {
      apiKey: 'AIzaSyAr_XqzCCNvkVivrsOMd_vtm6lgZ5OSWqU',
      authDomain: 'stalwart-coast-439901-d0.firebaseapp.com',
      projectId: 'stalwart-coast-439901-d0',
    };
    const app = getApps().length ? getApp() : initializeApp(cfg);
    const auth = getAuth(app);
    await auth.authStateReady();
    return auth.currentUser.getIdToken();
  });
  const phone = '3220000000';
  const book = (hora) =>
    fetch(`${API}/api/v1/b/${slug}/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({
        servicioId: svcId,
        empleadoId: empId,
        fecha,
        hora,
        clienteNombre: 'Smoke Prod',
        clienteTelefono: phone,
      }),
    });
  // Tope diario por defecto: 3 citas por teléfono/día (negocioMaxBookings).
  const ids = [];
  for (const h of ['10:00', '11:00', '12:00']) {
    const r = await book(h);
    expect(r.status).toBe(201);
    const j = await r.json();
    ids.push(j.id || j.cita_id);
  }
  const seg = await book('13:00');
  expect(seg.status).toBe(409);
  const segBody = await seg.json();
  expect(segBody.error).toBe('max_per_day');
  // El borrado en cascada exige sin citas futuras (409 recurso_con_citas):
  // se cancelan las 3 antes de borrar el catálogo.
  for (const id of ids) {
    const del = await fetch(`${API}/api/v1/b/${slug}/citas/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    expect([200, 204].includes(del.status)).toBe(true);
  }

  // AdminDashboard usa modal propio (confirmar), no dialog nativo.
  await page.getByLabel('Quitar a Smoky del equipo').click();
  await page.getByRole('button', { name: 'Sí, quitar' }).click();
  await expect(page.getByLabel('Quitar a Smoky del equipo')).toBeHidden({
    timeout: 15000,
  });

  await page.getByLabel('Eliminar servicio Corte Smoke').click();
  await page.getByRole('button', { name: 'Sí, eliminar' }).click();
  await expect(page.getByLabel('Eliminar servicio Corte Smoke')).toBeHidden({
    timeout: 15000,
  });

  const empDoc = await db
    .collection('negocios')
    .doc(slug)
    .collection('empleados')
    .doc(empId)
    .get();
  expect(empDoc.exists).toBe(false);
  const svcDoc = await db
    .collection('negocios')
    .doc(slug)
    .collection('servicios')
    .doc(svcId)
    .get();
  expect(svcDoc.exists).toBe(false);
});

test.afterAll(async () => {
  try {
    const user = await adminAuth.getUserByEmail(email);
    uid = user.uid;
  } catch {
    uid = null;
  }
  const reservas = await db
    .collection('reservas')
    .where('negocio_id', '==', slug)
    .get();
  for (const d of reservas.docs) await d.ref.delete().catch(() => {});
  const emps = await db.collection(`negocios/${slug}/empleados`).get();
  for (const d of emps.docs) await d.ref.delete().catch(() => {});
  const svcs = await db.collection(`negocios/${slug}/servicios`).get();
  for (const d of svcs.docs) await d.ref.delete().catch(() => {});
  await db.collection('clientes').where('negocio_id', '==', slug).get().then(async (snap) => {
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    if (!snap.empty) await batch.commit();
  }).catch(() => {});
  await db.collection('negocios').doc(slug).delete().catch(() => {});
  if (uid) await adminAuth.deleteUser(uid).catch(() => {});
});
