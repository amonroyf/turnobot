import { test, expect } from '@playwright/test';
import { db, adminAuth, limpiarEntornoReal, e2eSlug, crearUsuarioYTema, signInWithCustomToken } from './setup.js';

test.setTimeout(300_000);

test.describe('Directorio de Clientes (CRM)', () => {
  test('Muestra el historial de clientes con LTV y última visita', async ({ page }) => {
    const ts = Date.now();
    const nombre = `Cliente QA ${ts}`;
    const email = `crm${ts}@turnobot.test`;
    const slug = e2eSlug(nombre.toLowerCase().trim().replace(/[\s\W-]+/g, '-'));
    const tarjetaCliente = (nombreCliente) =>
      page.locator('div.rounded-2xl', { hasText: 'LTV' }).filter({ hasText: nombreCliente });

    try {
      const { email: userEmail, password } = await crearUsuarioYTema(email, nombre, slug);
      await page.goto('/register');
      await signInWithCustomToken(page, userEmail, password);
      await page.goto('/admin');

      await expect(page).toHaveURL(/\/admin$/);
      await expect(page.getByRole('heading', { name: nombre })).toBeVisible({ timeout: 30000 });

      const haceTresDias = new Date(Date.now() - 3 * 86400000);
      const hoy = new Date();
      await db.collection('clientes').doc(`${slug}__573001111111`).set({
        negocio_id: slug,
        cliente_phone: '+573001111111',
        client_name: 'Pepito Prueba',
        visits: 3,
        total_spent: 90000,
        last_seen: haceTresDias,
        last_date_str: '2026-09-01',
      });
      await db.collection('clientes').doc(`${slug}__573002222222`).set({
        negocio_id: slug,
        cliente_phone: '+573002222222',
        client_name: 'Juanita Prueba',
        visits: 1,
        total_spent: 45000,
        last_seen: hoy,
        last_date_str: '2026-09-04',
      });
      await db.collection('clientes').doc(`${slug}__573003333333`).set({
        negocio_id: slug,
        cliente_phone: '+573003333333',
        client_name: 'Sin Visitas',
        visits: 0,
        total_spent: 0,
        last_seen: null,
        last_date_str: '',
      });

      await page.getByText('Clientes', { exact: true }).first().click();
      await expect(
        page.getByRole('heading', { name: /Directorio de Clientes \(3\)/ }),
      ).toBeVisible({ timeout: 15000 });

      const tarjetaPepito = tarjetaCliente('Pepito Prueba');
      await expect(tarjetaPepito).toBeVisible();
      await expect(tarjetaPepito).toContainText('$90.000');
      await expect(tarjetaPepito).toContainText('3 visitas');
      await expect(tarjetaPepito).toContainText(/1 sept?\.?\s*2026/);

      const tarjetaJuanita = tarjetaCliente('Juanita Prueba');
      await expect(tarjetaJuanita).toContainText('$45.000');
      await expect(tarjetaJuanita).toContainText('1 visitas');
      await expect(tarjetaJuanita).toContainText(/4 sept?\.?\s*2026/);

      const tarjetaSinVisitas = tarjetaCliente('Sin Visitas');
      await expect(tarjetaSinVisitas).toContainText('N/A');

      await expect(page.locator('div.rounded-2xl', { hasText: 'LTV' }).first()).toContainText(
        'Pepito Prueba',
      );

      const linkPepito = tarjetaPepito.locator('a[href]').first();
      await expect(linkPepito).toHaveAttribute('href', /wa\.me\/.*573001111111/);
      await expect(tarjetaJuanita.locator('a[href]').first()).toHaveAttribute(
        'href',
        /wa\.me\/.*573002222222/,
      );
    } finally {
      const clientes = await db.collection('clientes').where('negocio_id', '==', slug).get();
      if (!clientes.empty) {
        const batch = db.batch();
        clientes.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }
      await limpiarEntornoReal(slug, email);
    }
  });
});
