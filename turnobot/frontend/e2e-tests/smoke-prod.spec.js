import { test, expect } from '@playwright/test';
import { db, adminAuth } from './setup.js';

const BASE = 'https://turnobot-web.web.app';
const API = 'https://turnobot-ehomyvoh6q-uc.a.run.app';
const ts = Date.now();
const slug = `smokeprod${ts}`;
const email = `smoke${ts}@turnobot.test`;
let uid;

test('Smoke prod: registro, catálogo, slots por jornada y eliminación en cascada', async ({
  page,
}) => {
  test.setTimeout(120000);

  // Health del backend en prod
  const health = await fetch(`${API}/health`);
  expect(health.ok).toBe(true);
  expect(await health.text()).toContain('OK');

  await page.goto(`${BASE}/register`);
  await page.getByText('¿Prefieres crear tu cuenta con correo y contraseña?').click();
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill('Clave.123');
  await page.getByRole('button', { name: 'Crear cuenta con correo' }).click();

  await expect(page.getByPlaceholder('Ej. Barbería VIP')).toBeVisible();
  await page.getByPlaceholder('Ej. Barbería VIP').fill(`Smoke Prod ${ts}`);
  await page.locator('input[type="text"]').nth(1).fill(slug);
  await page.getByRole('button', { name: 'Finalizar Configuración' }).click();

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: `Smoke Prod ${ts}` })).toBeVisible({
    timeout: 30000,
  });

  // Guardar horarios de operación
  await page.locator('input[type="time"]').nth(0).fill('10:00');
  await page.locator('input[type="time"]').nth(1).fill('14:00');
  await page.getByRole('button', { name: 'Guardar Horario' }).click();
  await expect(page.getByRole('button', { name: 'Guardando...' })).toBeHidden({
    timeout: 10000,
  });

  // Crear servicio y profesional
  await page.getByPlaceholder('Nombre (ej. Corte clásico)').fill('Corte Smoke');
  await page.getByPlaceholder('Minutos').fill('60');
  await page.getByPlaceholder('Precio').fill('20000');
  await page.getByRole('button', { name: 'Guardar Servicio' }).click();
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

  // Slots limitados a la jornada 10:00-14:00 (backend en prod)
  const manana = new Date(Date.now() + 86400000);
  const fecha = manana.toISOString().split('T')[0];
  const slotsRes = await fetch(
    `${API}/api/v1/b/${slug}/slots?emp_id=${empId}&servicio_id=${svcId}&fecha=${fecha}`,
  );
  expect(slotsRes.ok).toBe(true);
  const slots = await slotsRes.json();
  expect(slots.length).toBeGreaterThan(0);
  expect(slots.every((h) => h >= '10:00' && h < '14:00')).toBe(true);

  // Eliminar el profesional desde el panel (cascada con token de dueño en prod)
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Eliminar profesional Smoky' }).click();
  await expect(page.getByText('Smoky')).toBeHidden({ timeout: 15000 });

  // Eliminar el servicio desde el panel
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Eliminar servicio Corte Smoke' }).click();
  await expect(page.getByText('Corte Smoke')).toBeHidden({ timeout: 15000 });

  // Verifica en Firestore que ya no existen
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
  await db.collection('negocios').doc(slug).delete().catch(() => {});
  if (uid) await adminAuth.deleteUser(uid).catch(() => {});
});