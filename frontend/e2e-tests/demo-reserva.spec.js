import { test, expect } from '@playwright/test';
import { CLIENTE_E2E, db, signInEnPagina } from './setup.js';

let clienteDemo;

test('Grabar demo de reserva', async ({ page }) => {
  test.setTimeout(60000);
  const screenshotPath = (step) => `${process.cwd()}/test-results/demo-cliente-${step}.png`;
  const suffix = Math.floor(100 + Math.random() * 900);
  const cliente = `Cliente Demo ${suffix}`;
  clienteDemo = cliente;
  const telefono = `300123${String(suffix).padStart(4, '0')}`;

  await page.goto('/shop/mi-negocio');
  await signInEnPagina(page, CLIENTE_E2E.email, CLIENTE_E2E.password);
  await page.reload();

  await page.getByText('Consulta General', { exact: true }).click();
  await page.screenshot({ path: screenshotPath('01-servicio'), fullPage: true });
  await page.getByText('Alejandro', { exact: true }).click();
  await page.screenshot({ path: screenshotPath('02-profesional'), fullPage: true });

  const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await page.getByRole('button', { name: `Elegir ${manana}` }).click();
  await page.screenshot({ path: screenshotPath('03-fecha'), fullPage: true });

  const primerHorario = page.locator('#step-4 div.grid-cols-3 button').first();
  await expect(primerHorario).toBeVisible({ timeout: 10000 });
  await primerHorario.click();
  await page.screenshot({ path: screenshotPath('04-hora'), fullPage: true });

  await page.getByPlaceholder('Tu Nombre completo').fill(cliente);
  await page.getByPlaceholder('Tu WhatsApp (Ej. 300 123 4567)').fill(telefono);
  await page.getByPlaceholder('¿Algo que debamos saber? (opcional, máx 500 caracteres)').fill(
    `Reserva de demostración ${suffix}. Primera visita al local.`,
  );
  await page.screenshot({ path: screenshotPath('05-datos'), fullPage: true });
  await page.waitForTimeout(1000);

  await page.getByRole('button', { name: 'Confirmar Reserva' }).click();
  await expect(page.getByText('¡Cita confirmada!')).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: screenshotPath('06-confirmada'), fullPage: true });
  await page.waitForTimeout(3000);
});

test.afterAll(async () => {
  if (!clienteDemo) return;
  const snapshot = await db
    .collection('reservas')
    .where('negocio_id', '==', 'mi-negocio')
    .get();
  const propias = snapshot.docs.filter((doc) => doc.data().client_name === clienteDemo);
  if (!propias.length) return;
  const batch = db.batch();
  propias.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
});