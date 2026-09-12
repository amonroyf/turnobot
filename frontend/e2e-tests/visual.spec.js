import { test, expect } from '@playwright/test';
import { e2eSlug, elegirDiaEnCalendario } from './setup.js';

// Pruebas visuales de regresión: comparan screenshots contra la línea base
// (e2e-tests/visual.spec.js-snapshots/). Si cambia algo visual sin querer,
// el test falla mostrando el diff.
// Regenerar base: npx playwright test visual.spec.js --update-snapshots
// Requiere backend en :8080 apuntando al emulador + frontend en :5173.

const SLUG = e2eSlug('tienda');

const mañana = () => {
  const d = new Date(Date.now() + 86400000);
  return d.toISOString().slice(0, 10);
};

test.describe('Regresión visual', () => {
  test('booking paso 1: lista de servicios', async ({ page }) => {
    await page.goto(`/shop/${SLUG}`);
    await expect(page.getByText('Corte y Barba').first()).toBeVisible();
    await expect(page).toHaveScreenshot('booking-paso-1.png', { animations: 'disabled' });
  });

  test('booking paso 2: profesionales', async ({ page }) => {
    await page.goto(`/shop/${SLUG}`);
    await page.getByText('Corte y Barba').first().click();
    await expect(page.getByText('Alejandro', { exact: true })).toBeVisible();
    await expect(page).toHaveScreenshot('booking-paso-2.png', { animations: 'disabled' });
  });

  test('mis citas: estado inicial', async ({ page }) => {
    await page.goto(`/shop/${SLUG}`);
    await page.getByRole('button', { name: /Mis Citas/ }).click();
    await expect(page.getByText('Consultar o cancelar citas')).toBeVisible();
    await expect(page).toHaveScreenshot('mis-citas.png', { animations: 'disabled' });
  });

  test('registro: paso 1', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByText('Continuar con Google')).toBeVisible();
    await expect(page).toHaveScreenshot('register.png', { animations: 'disabled' });
  });

  test('admin sin sesión: login', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText('Iniciar Sesión con Google')).toBeVisible();
    await expect(page).toHaveScreenshot('admin-login.png', { animations: 'disabled' });
  });

  test('booking éxito: pantalla de confirmación', async ({ page }) => {
    await page.goto(`/shop/${SLUG}`);
    await page.getByRole('button', { name: /Agendar/ }).click();
    await page.getByText('Corte y Barba').first().click();
    await page.getByText('Alejandro', { exact: true }).click();
    await page.getByRole('button', { name: 'Mes siguiente' }).waitFor({ state: 'visible' }).catch(() => {});
    await elegirDiaEnCalendario(page, mañana());
    await expect(page.locator('div.grid-cols-3 button').first()).toBeVisible();
    await page.locator('div.grid-cols-3 button').first().click();
    await page.getByPlaceholder('Tu Nombre completo').fill('Visual Test');
    await page.getByPlaceholder(/Tu WhatsApp/).fill('300 123 4567');
    await page.getByRole('button', { name: 'Confirmar Reserva' }).click();
    const exito = page.locator('#step-success');
    await expect(exito).toBeVisible({ timeout: 20000 });
    // La fecha/hora del resumen cambian a diario: se enmascaran.
    await expect(page).toHaveScreenshot('booking-exito.png', {
      animations: 'disabled',
      mask: [exito.locator('div.text-left'), page.locator('#step-5')],
    });
  });
});
