import { test, expect } from '@playwright/test';
import { db, adminAuth, crearUsuarioYTema, signInWithCustomToken } from './setup.js';

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

  // Ir al registro, hacer login y esperar a que Firebase Auth se establezca
  await page.goto(`${BASE}/register`);
  await signInWithCustomToken(page, userEmail, password);
  // Esperar a que el SDK de Firebase Auth se inicialice tras el reload
  await page.waitForFunction(() => typeof firebase !== 'undefined' || window.firebase !== undefined, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.goto(`${BASE}/admin`);
  // Esperar a que el panel cargue (el usuario ya tiene negocio creado por crearUsuarioYTema)
  await page.waitForTimeout(5000);

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText(`Smoke Prod ${ts}`)).toBeVisible({
    timeout: 30000,
  });

  await page.getByPlaceholder('Nombre (ej. Corte clásico)').fill('Corte Smoke');
  await page.getByPlaceholder('Minutos').fill('60');
  await page.getByPlaceholder('Precio').fill('20000');
  await page.getByRole('button', { name: /Agregar Servicio/ }).click();
  await expect(page.getByText('Corte Smoke')).toBeVisible({ timeout: 20000 });

  await page.getByPlaceholder('Nombre del profesional').fill('Smoky');
  await page.getByRole('button', { name: 'Añadir Profesional' }).click();
  await expect(page.getByText('Smoky')).toBeVisible({ timeout: 20000 });
  const empleado = await db
    .collection('negocios')
    .doc(slug)
    .collection('empleados')
    .where('name', '==', 'Smoky')
    .get();
  const empId = empleado.docs[0].id;
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

  const phone = '3220000000';
  const book = (hora) =>
    fetch(`${API}/api/v1/b/${slug}/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        servicioId: svcId,
        empleadoId: empId,
        fecha,
        hora,
        clienteNombre: 'Smoke Prod',
        clienteTelefono: phone,
      }),
    });
  expect((await book('10:00')).status).toBe(201);
  const seg = await book('11:00');
  expect(seg.status).toBe(409);
  const segBody = await seg.json();
  expect(segBody.error).toBe('max_per_day');

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Eliminar profesional Smoky' }).click();
  await expect(
    page.getByRole('button', { name: 'Eliminar profesional Smoky' }),
  ).toBeHidden({ timeout: 15000 });

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Eliminar servicio Corte Smoke' }).click();
  await expect(
    page.getByRole('button', { name: 'Eliminar servicio Corte Smoke' }),
  ).toBeHidden({ timeout: 15000 });

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
