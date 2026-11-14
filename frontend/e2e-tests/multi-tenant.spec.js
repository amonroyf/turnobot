import { test, expect } from '@playwright/test';
import {
  CLIENTE_E2E,
  limpiarNegocioE2E,
  crearReservaE2E,
  db,
  adminAuth,
  e2eSlug,
  signInEnPagina,
} from './setup.js';

const TIENDA_A = e2eSlug('alfa');
const TIENDA_B = e2eSlug('beta');

async function garantizarTienda(slug, servicios, empleado) {
  const negocioRef = db.collection('negocios').doc(slug);
  await negocioRef.set(
    {
      name: slug,
      owner_uid: 'e2e-owner',
      whatsapp: '',
      direccion: 'Calle de pruebas 123',
      horario: 'Lun - Sáb: 9:00 AM a 6:00 PM',
      telefono: '3000000000',
      calendar_id: 'primary',
      timezone: 'America/Bogota',
      cancel_window_hours: 1,
    },
    { merge: true },
  );
  for (const s of servicios) {
    await db
      .collection('negocios')
      .doc(slug)
      .collection('servicios')
      .doc(s.id)
      .set({ name: s.name, duration_minutes: 30, price: s.price });
  }
  await db
    .collection('negocios')
    .doc(slug)
    .collection('empleados')
    .doc(empleado.id)
    .set({ name: empleado.name, calendar_id: '' });
}

test.describe('Módulo 4: Aislamiento Multi-Tenant', () => {
  const mañana = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  test.beforeAll(async () => {
    await garantizarTienda(TIENDA_A, [{ id: 'svc_alfa', name: 'Corte Alfa', price: '15000' }], {
      id: 'emp_a',
      name: 'Ana Alfa',
    });
    await garantizarTienda(TIENDA_B, [{ id: 'svc_beta', name: 'Corte Beta', price: '20000' }], {
      id: 'emp_b',
      name: 'Belén Beta',
    });
  });

  test('Los servicios de la Tienda A no se filtran en la Tienda B (y viceversa)', async ({
    page,
  }) => {
    await page.goto(`/shop/${TIENDA_A}`);
    await page.getByRole('button', { name: /Agendar/ }).first().click();
    await expect(page.getByText('Corte Alfa').first()).toBeVisible();
    await expect(page.getByText('Corte Beta')).toHaveCount(0);

    await page.goto(`/shop/${TIENDA_B}`);
    await page.getByRole('button', { name: /Agendar/ }).first().click();
    await expect(page.getByText('Corte Beta').first()).toBeVisible();
    await expect(page.getByText('Corte Alfa')).toHaveCount(0);
  });

  test('El backend no expone las citas de otra tienda al consultar por cuenta', async ({
    page,
  }) => {
    const phone = '3207778888';
    const cliente = await adminAuth.getUserByEmail(CLIENTE_E2E.email);
    const dt = new Date(`${mañana()}T10:00:00-05:00`);
    await crearReservaE2E({
      slug: TIENDA_B,
      phone,
      name: 'Cliente Beta',
      service: 'Corte Beta',
      empId: 'emp_b',
      dateTime: dt,
      clientUid: cliente.uid,
    });

    // La cuenta no debe ver la cita al consultar en la tienda equivocada
    await page.goto(`/shop/${TIENDA_A}`);
    await signInEnPagina(page, CLIENTE_E2E.email, CLIENTE_E2E.password);
    await page.reload();
    await page.getByRole('button', { name: 'Mis Citas' }).click();
    await expect(page.getByText(/Sin citas con esta cuenta/)).toBeVisible({
      timeout: 10000,
    });

    // Y sí aparece en la tienda correcta
    await page.goto(`/shop/${TIENDA_B}`);
    await page.getByRole('button', { name: 'Mis Citas' }).click();
    await expect(page.getByText('Corte Beta').first()).toBeVisible({
      timeout: 15000,
    });
  });

  test.afterAll(async () => {
    await limpiarNegocioE2E(TIENDA_A);
    await limpiarNegocioE2E(TIENDA_B);
  });
});