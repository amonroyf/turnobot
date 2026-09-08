import { test, expect } from '@playwright/test';
import { limpiarReservasE2E, crearReservaE2E, db } from './setup.js';

const TIENDA_A = 'tienda-alfa';
const TIENDA_B = 'tienda-beta';

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
    await page.getByText('Agendar cita', { exact: false }).first().click();
    await expect(page.getByText('Corte Alfa').first()).toBeVisible();
    await expect(page.getByText('Corte Beta')).toHaveCount(0);

    await page.goto(`/shop/${TIENDA_B}`);
    await page.getByText('Agendar cita', { exact: false }).first().click();
    await expect(page.getByText('Corte Beta').first()).toBeVisible();
    await expect(page.getByText('Corte Alfa')).toHaveCount(0);
  });

  test('El backend no expone las citas de otra tienda al consultar por teléfono', async ({
    page,
  }) => {
    const phone = '3207778888';
    const dt = new Date(`${mañana()}T10:00:00-05:00`);
    await crearReservaE2E({
      slug: TIENDA_B,
      phone,
      name: 'Cliente Beta',
      service: 'Corte Beta',
      empId: 'emp_b',
      dateTime: dt,
    });

    // El mismo teléfono consultado en la tienda equivocada no debe aparecer
    await page.goto(`/shop/${TIENDA_A}`);
    await page.getByText('Mis citas', { exact: false }).click();
    await page.getByPlaceholder('Tu WhatsApp (Ej. 3001234567)').fill(phone);
    await page.getByRole('button', { name: 'Ver mis citas' }).click();
    await expect(page.getByText(/No tienes citas pendientes/)).toBeVisible();

    // Y sí aparece en la tienda correcta
    await page.goto(`/shop/${TIENDA_B}`);
    await page.getByText('Mis citas', { exact: false }).click();
    await page.getByPlaceholder('Tu WhatsApp (Ej. 3001234567)').fill(phone);
    await page.getByRole('button', { name: 'Ver mis citas' }).click();
    await expect(page.getByText('Corte Beta').first()).toBeVisible();
  });

  test.afterAll(async () => {
    await limpiarReservasE2E(TIENDA_A);
    await limpiarReservasE2E(TIENDA_B);
  });
});