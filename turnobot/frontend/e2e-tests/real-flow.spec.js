import { test, expect } from '@playwright/test';
import { limpiarEntornoReal, db } from './setup.js';

const SLUG_REAL = 'e2e-shop-test';
const EMAIL_REAL = 'owner-e2e@turnobot.com';
const PASS_REAL = 'Turnobot2026!';

const mañana = () => {
  const d = new Date(Date.now() + 86400000);
  return d.toISOString().slice(0, 10);
};

test.describe('E2E Real (sin mocks): registro, catálogo y reservas', () => {
  test.beforeAll(async () => {
    await limpiarEntornoReal(SLUG_REAL, EMAIL_REAL);
  });

  test('El dueño se registra y crea el catálogo de su barbería', async ({ page }) => {
    // 1. Registro real en Firebase Auth (paso 1: correo/contraseña)
    await page.goto('/register');
    await page.getByText('¿Prefieres crear tu cuenta con correo y contraseña?').click();
    await page.locator('input[type="email"]').fill(EMAIL_REAL);
    await page.locator('input[type="password"]').fill(PASS_REAL);
    await page.getByRole('button', { name: 'Crear cuenta con correo' }).click();

    // 2. Paso 2: nombre y slug del negocio
    await expect(page.getByPlaceholder('Ej. Barbería VIP')).toBeVisible();
    await page.getByPlaceholder('Ej. Barbería VIP').fill('Barbería E2E');
    await page.locator('input[type="text"]').nth(1).fill(SLUG_REAL);
    await page.getByRole('button', { name: 'Finalizar Configuración' }).click();

    // 3. Acceso al Dashboard y correo persistido
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Barbería E2E' })).toBeVisible({
      timeout: 30000,
    });

    // 3. Crear servicio en Firestore real
    await page.getByPlaceholder('Nombre (ej. Corte clásico)').fill('Corte Premium');
    await page.getByPlaceholder('Minutos').fill('45');
    await page.getByPlaceholder('Precio').fill('35000');
    await page.getByRole('button', { name: 'Guardar Servicio' }).click();
    await expect(page.getByText('Corte Premium')).toBeVisible({ timeout: 20000 });

    // 4. Crear profesional en Firestore real
    await page.getByPlaceholder('Nombre del profesional').fill('Barbero E2E');
    await page.getByRole('button', { name: 'Añadir Profesional' }).click();
    await expect(page.getByText('Barbero E2E')).toBeVisible({ timeout: 20000 });

    // Verificación directa en la BD
    const doc = await db.collection('negocios').doc(SLUG_REAL).get();
    expect(doc.exists).toBe(true);
    expect(doc.data().name).toBe('Barbería E2E');
    const svc = await db
      .collection('negocios')
      .doc(SLUG_REAL)
      .collection('servicios')
      .get();
    expect(svc.docs.map((d) => d.data().name)).toContain('Corte Premium');
    const emp = await db
      .collection('negocios')
      .doc(SLUG_REAL)
      .collection('empleados')
      .get();
    expect(emp.docs.map((d) => d.data().name)).toContain('Barbero E2E');
  });

  test('El cliente agenda exitosamente a través del embudo público', async ({ page }) => {
    await page.goto(`/shop/${SLUG_REAL}`);
    await page.getByText('Agendar cita', { exact: false }).first().click();

    await expect(page.getByText('Corte Premium').first()).toBeVisible();
    await page.getByText('Corte Premium').first().click();

    await expect(page.getByText('Barbero E2E', { exact: true }).first()).toBeVisible();
    await page.getByText('Barbero E2E', { exact: true }).first().click();

    await expect(page.locator('input[type="date"]')).toBeVisible();
    await page.fill('input[type="date"]', mañana());

    // El frontend consulta los slots al backend Go real
    await expect(page.locator('.grid button').first()).toBeVisible();
    await page.locator('.grid button').first().click();

    await page.getByPlaceholder('Tu Nombre').fill('Cliente Automatizado');
    await page.getByPlaceholder('Tu WhatsApp (Ej. 3001234567)').fill('300 123 4567');
    await page.getByRole('button', { name: 'Confirmar Reserva' }).click();

    await expect(page.getByText('¡Tu cita está casi lista!')).toBeVisible({ timeout: 15000 });
  });

  test('Prevención de Doble Reserva (Status 409 Conflict)', async ({ browser }) => {
    test.setTimeout(60000);
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    async function hastaConfirmacion(page) {
      await page.goto(`/shop/${SLUG_REAL}`);
      await page.getByText('Agendar cita', { exact: false }).first().click();
      await page.getByText('Corte Premium').first().click();
      await page.getByText('Barbero E2E', { exact: true }).first().click();
      await page.fill('input[type="date"]', mañana());
      await page.locator('.grid button').first().click();
      await page.getByPlaceholder('Tu Nombre').fill('Usuario Rápido');
      await page.getByPlaceholder('Tu WhatsApp (Ej. 3001234567)').fill('3000000001');
    }

    await hastaConfirmacion(p1);
    await p2.goto(`/shop/${SLUG_REAL}`);
    await p2.getByText('Agendar cita', { exact: false }).first().click();
    await p2.getByText('Corte Premium').first().click();
    await p2.getByText('Barbero E2E', { exact: true }).first().click();
    await p2.fill('input[type="date"]', mañana());
    await p2.locator('.grid button').first().click();
    await p2.getByPlaceholder('Tu Nombre').fill('Usuario Lento');
    await p2.getByPlaceholder('Tu WhatsApp (Ej. 3001234567)').fill('3000000002');

    // El primero reserva y bloquea el slot
    await p1.getByRole('button', { name: 'Confirmar Reserva' }).click();
    await expect(p1.getByText('¡Tu cita está casi lista!')).toBeVisible();

    // El segundo recibe 409: error en DOM y recarga de horarios (sin alert)
    const refetch = p2.waitForResponse(
      (r) => r.url().includes('/slots') && r.request().method() === 'GET',
      { timeout: 15000 },
    );
    await p2.getByRole('button', { name: 'Confirmar Reserva' }).click();
    await expect(p2.getByText(/acaba de ser reservado por alguien más/)).toBeVisible();
    await expect(p2.getByText(/Horarios para el/)).toBeVisible();
    await refetch;
  });

  test.afterAll(async () => {
    await limpiarEntornoReal(SLUG_REAL, EMAIL_REAL);
  });
});