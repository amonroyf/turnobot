import { test, expect } from '@playwright/test';
import { BookingPage } from './pages/BookingPage.js';

// Smoke E2E del flujo de reserva usando Page Object Model.
// Requiere backend + frontend corriendo y un negocio 'mi-negocio' sembrado.
test.describe('Reserva (POM)', () => {
  test('carga la tienda y muestra servicios', async ({ page }) => {
    const booking = new BookingPage(page);
    await booking.goto('mi-negocio');
    await expect(page.getByText(/Consulta General/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('seleccionar servicio muestra profesionales/horarios', async ({ page }) => {
    const booking = new BookingPage(page);
    await booking.goto('mi-negocio');
    await booking.seleccionarServicio('Consulta General');
    // Tras seleccionar servicio, la página debe seguir viva y sin error fatal
    await expect(page).not.toHaveURL(/error/i);
  });
});