import { test, expect } from '@playwright/test';
import {
  CLIENTE_E2E,
  limpiarEntornoReal,
  elegirDiaEnCalendario,
  db,
  crearUsuarioYTema,
  signInEnPagina,
  telefonoUnico,
} from './setup.js';

const SLUG_REAL = 'e2e-shop-test';
const EMAIL_REAL = 'owner-e2e@turnobot.com';

const mañana = () => {
  const d = new Date(Date.now() + 86400000);
  return d.toISOString().slice(0, 10);
};

async function iniciarSesionCliente(page, slug) {
  await page.goto(`/shop/${slug}`);
  await signInEnPagina(page, CLIENTE_E2E.email, CLIENTE_E2E.password);
  await page.reload();
}

test.describe('E2E Real (sin mocks): registro, catálogo y reservas', () => {
  test.beforeAll(async () => {
    await limpiarEntornoReal(SLUG_REAL, EMAIL_REAL);
  });

  test('El dueño se registra y crea el catálogo de su negocio', async ({ page }) => {
    // 1. Registro: /register hoy es solo Google (sin flujo correo/contraseña en UI).
    // Se crea el usuario vía Admin SDK y se inicia sesión con token personalizado,
    // igual que smoke-prod.spec.js y crm.spec.js.
    const { email: userEmail, password } = await crearUsuarioYTema(EMAIL_REAL, 'Negocio E2E', SLUG_REAL);
    await page.goto('/register');
    await signInEnPagina(page, userEmail, password);
    await page.goto('/admin');

    // 2. Acceso al Dashboard con el negocio pre-creado por crearUsuarioYTema
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Negocio E2E' })).toBeVisible({
      timeout: 30000,
    });

    await page.getByRole('button', { name: 'Ajustes' }).click();

    // 3. Crear servicio en Firestore real (selectores vigentes de AdminDashboard.jsx)
    await page.getByPlaceholder('Ej. Corte, Uñas, Limpieza').fill('Consulta Premium');
    await page.getByPlaceholder('Ej. 30', { exact: true }).fill('45');
    await page.getByPlaceholder('Ej. 20000').fill('35000');
    await page.getByRole('button', { name: /Agregar Servicio/ }).click();
    await expect(page.getByText('Consulta Premium')).toBeVisible({ timeout: 20000 });

    // 4. Crear profesional en Firestore real
    await page.getByPlaceholder('Ej. Camila, Andrés…').fill('Profesional E2E');
    await page.getByRole('button', { name: '+ Añadir al equipo' }).click();
    await expect(page.getByText('Profesional E2E').first()).toBeVisible({
      timeout: 20000,
    });

    // Verificación directa en la BD
    const doc = await db.collection('negocios').doc(SLUG_REAL).get();
    expect(doc.exists).toBe(true);
    expect(doc.data().name).toBe('Negocio E2E');
    const svc = await db
      .collection('negocios')
      .doc(SLUG_REAL)
      .collection('servicios')
      .get();
    expect(svc.docs.map((d) => d.data().name)).toContain('Consulta Premium');
    const emp = await db
      .collection('negocios')
      .doc(SLUG_REAL)
      .collection('empleados')
      .get();
    expect(emp.docs.map((d) => d.data().name)).toContain('Profesional E2E');
  });

  test('El cliente agenda exitosamente a través del embudo público', async ({ page }) => {
    await iniciarSesionCliente(page, SLUG_REAL);
    await page.getByRole('button', { name: /Agendar/ }).click();

    await expect(page.getByText('Consulta Premium').first()).toBeVisible();
    await page.getByText('Consulta Premium').first().click();

    await expect(page.getByText('Profesional E2E', { exact: true }).first()).toBeVisible();
    await page.getByText('Profesional E2E', { exact: true }).first().click();

    await expect(page.getByRole('button', { name: 'Mes siguiente' })).toBeVisible();
    await elegirDiaEnCalendario(page, mañana());

    // El frontend consulta los slots al backend Go real
    await expect(page.locator('div.grid-cols-3 button').first()).toBeVisible();
    await page.locator('div.grid-cols-3 button').first().click();

    await page.getByPlaceholder('Tu Nombre completo').fill('Cliente Automatizado');
    await page.getByPlaceholder('Tu WhatsApp (Ej. 300 123 4567)').fill(telefonoUnico());
    await page.getByRole('button', { name: 'Confirmar Reserva' }).click();

    await expect(page.getByText('¡Cita confirmada!')).toBeVisible({ timeout: 15000 });
  });

  test('Prevención de Doble Reserva (Status 409 Conflict)', async ({ browser }) => {
    test.setTimeout(120000);
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    async function hastaConfirmacion(page) {
      await iniciarSesionCliente(page, SLUG_REAL);
      await page.getByRole('button', { name: /Agendar/ }).click();
      await page.getByText('Consulta Premium').first().click();
      await page.getByText('Profesional E2E', { exact: true }).first().click();
      await elegirDiaEnCalendario(page, mañana());
      await page.locator('div.grid-cols-3 button').first().click();
      await page.getByPlaceholder('Tu Nombre completo').fill('Usuario Rápido');
      await page.getByPlaceholder('Tu WhatsApp (Ej. 300 123 4567)').fill(telefonoUnico());
    }

    await hastaConfirmacion(p1);
    await iniciarSesionCliente(p2, SLUG_REAL);
    await p2.getByRole('button', { name: /Agendar/ }).click();
    await p2.getByText('Consulta Premium').first().click();
    await p2.getByText('Profesional E2E', { exact: true }).first().click();
    await elegirDiaEnCalendario(p2, mañana());
    await p2.locator('div.grid-cols-3 button').first().click();
    await p2.getByPlaceholder('Tu Nombre completo').fill('Usuario Lento');
    await p2.getByPlaceholder('Tu WhatsApp (Ej. 300 123 4567)').fill(telefonoUnico());

    // El primero reserva y bloquea el slot
    await p1.getByRole('button', { name: 'Confirmar Reserva' }).click();
    await expect(p1.getByText('¡Cita confirmada!')).toBeVisible();

    // El segundo recibe 409: error en DOM y recarga de horarios (sin alert)
    const refetch = p2.waitForResponse(
      (r) => r.url().includes('/slots') && r.request().method() === 'GET',
      { timeout: 15000 },
    );
    await p2.getByRole('button', { name: 'Confirmar Reserva' }).click();
    await expect(p2.getByText(/Ese horario ya no está libre/)).toBeVisible();
    await expect(p2.getByText(/Horarios para el/)).toBeVisible();
    await refetch;
  });

  test.afterAll(async () => {
    await limpiarEntornoReal(SLUG_REAL, EMAIL_REAL);
  });
});