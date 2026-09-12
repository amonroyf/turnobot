import { test, expect } from '@playwright/test';
import { limpiarReservasE2E, crearReservaE2E, elegirDiaEnCalendario, db, e2eSlug } from './setup.js';

const SLUG = e2eSlug('tienda');

const mañana = () => {
  const d = new Date(Date.now() + 86400000);
  return d.toISOString().slice(0, 10);
};

// Lleva la página del cliente hasta el paso 4 (formulario de confirmación),
// eligiendo automáticamente servicio, barbero, fecha y dejando los slots cargados.
async function llegarAConfirmacion(page) {
  await page.goto(`/shop/${SLUG}`);
  await expect(page.getByRole('button', { name: /Agendar/ })).toBeVisible();
  await page.getByRole('button', { name: /Agendar/ }).click();

  await expect(page.getByText('Corte y Barba').first()).toBeVisible();
  await page.getByText('Corte y Barba').first().click();

  await expect(page.getByText('Alejandro').first()).toBeVisible();
  await page.getByText('Alejandro', { exact: true }).click();

  await expect(page.getByRole('button', { name: 'Mes siguiente' })).toBeVisible();
  await elegirDiaEnCalendario(page, mañana());

  // Paso 3: los slots se cargan en un grid de botones
  await expect(page.locator('div.grid-cols-3 button').first()).toBeVisible();
}

async function elegirPrimerSlot(page) {
  await page.locator('div.grid-cols-3 button').first().click();
  await expect(page.getByPlaceholder('Tu Nombre completo')).toBeVisible();
}

async function llenarYConfirmar(page, nombre, telefono) {
  await page.getByPlaceholder('Tu Nombre completo').fill(nombre);
  await page.getByPlaceholder('Tu WhatsApp (Ej. 300 123 4567)').fill(telefono);
  await page.getByRole('button', { name: 'Confirmar Reserva' }).click();
}

test.describe('Turnobot E2E Suite', () => {
  test.beforeEach(async () => {
    await limpiarReservasE2E(SLUG);
  });

  test('Happy Path: agendamiento exitoso y teléfono saneado en BD', async ({ page }) => {
    await llegarAConfirmacion(page);
    await elegirPrimerSlot(page);
    await llenarYConfirmar(page, 'Juan E2E', '300 123 4567'); // con espacios -> 3001234567

    await expect(page.getByText('¡Cita reservada con éxito!')).toBeVisible();

    // Verificar que en Firestore el teléfono quedó saneado (E.164: +573001234567)
    const snap = await db
      .collection('reservas')
      .where('user_phone', '==', '+573001234567')
      .get();
    expect(snap.empty).toBe(false);
  });

  test('Condición de Carrera: el segundo usuario recibe 409 y vuelve a horarios', async ({
    browser,
  }) => {
    test.setTimeout(60000);
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    await llegarAConfirmacion(p1);
    await llegarAConfirmacion(p2);

    // Ambos eligen el MISMO slot (el primero disponible = 09:00)
    await elegirPrimerSlot(p1);
    await elegirPrimerSlot(p2);

    // Cliente 1 agenda y alcanza la pantalla de éxito
    await llenarYConfirmar(p1, 'Cliente Rápido', '3111111111');
    await expect(p1.getByText('¡Cita reservada con éxito!')).toBeVisible();

    // Cliente 2 intenta el mismo slot: el backend debe responder 409
    // y el frontend debe recargar los horarios (refetch). Esperamos la
    // respuesta de red para no depender del timing del DOM.
    const refetch = p2.waitForResponse(
      (r) => r.url().includes('/slots') && r.request().method() === 'GET',
      { timeout: 15000 },
    );
    await llenarYConfirmar(p2, 'Cliente Lento', '3222222222');

    await expect(p2.getByText(/acaba de ser reservado por alguien más/)).toBeVisible();
    await expect(p2.getByText(/Horarios para el/)).toBeVisible();

    // La recarga llegó y el slot 09:00 está ausente en la respuesta
    const cuerpo = await (await refetch).json();
    expect(cuerpo.map((s) => s.trim())).not.toContain('09:00');

    // Y en pantalla el botón 09:00 desaparece
    await expect(p2.getByRole('button', { name: '09:00' })).toHaveCount(0);
  });

  test('Mis Citas: consultar y cancelar una reserva', async ({ page }) => {
    const phone = '3051112222';
    const dt = new Date(`${mañana()}T15:30:00-05:00`);
    await crearReservaE2E({
      slug: SLUG,
      phone,
      name: 'Ana E2E',
      service: 'Corte y Barba',
      empId: 'emp_alejandro',
      dateTime: dt,
    });

    await page.goto(`/shop/${SLUG}`);
    await page.getByText('Mis citas', { exact: false }).click();

    await page.getByPlaceholder('Tu WhatsApp (Ej. 300 123 4567)').fill(phone);
    await page.getByRole('button', { name: 'Ver mis citas' }).click();

    await expect(page.getByText('Corte y Barba').first()).toBeVisible();

    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Cancelar cita' }).click();

    // Tras cancelar se muestra el aviso de confirmación (la agenda quedó liberada)
    await expect(page.getByText('Cita cancelada')).toBeVisible();
    await expect(page.getByText('El espacio en la agenda ha sido liberado.')).toBeVisible();

    // Verificar que la reserva quedó marcada como cancelada
    const snap = await db.collection('reservas').where('user_phone', '==', phone).get();
    expect(snap.empty).toBe(false);
    expect(snap.docs[0].data().cancelled).toBe(true);
  });
});