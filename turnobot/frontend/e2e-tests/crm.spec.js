import { test, expect } from '@playwright/test';
import { db, limpiarEntornoReal } from './setup.js';

test.setTimeout(120_000);

// ─────────────────────────────────────────────────────────────────────────────
// HARNESS del módulo CRM ("Directorio de Clientes")
// ─────────────────────────────────────────────────────────────────────────────
// Verifica que el panel del dueño lea la colección clientes (mantenida por el
// backend) y muestre: nombre, WhatsApp, LTV, visitas y última visita relativa.
test.describe('Directorio de Clientes (CRM)', () => {
  test('Muestra el historial de clientes con LTV y última visita', async ({ page }) => {
    const ts = Date.now();
    const nombre = `Cliente QA ${ts}`;
    const email = `crm${ts}@turnobot.test`;
    const slug = nombre.toLowerCase().trim().replace(/[\s\W-]+/g, '-');

    try {
      // 1. Registro del local (crea el negocio y la sesión del dueño en el navegador)
      await page.goto('/register');
      await page.getByText('¿Prefieres crear tu cuenta con correo y contraseña?').click();
      await page.locator('input[type="email"]').fill(email);
      await page.locator('input[type="password"]').fill('Clave.123');
      await page.getByRole('button', { name: 'Crear cuenta con correo' }).click();

      await expect(page.getByPlaceholder('Ej. Clínica Wellness / Auto Detailing')).toBeVisible();
      await page.getByPlaceholder('Ej. Clínica Wellness / Auto Detailing').fill(nombre);
      await page.getByRole('button', { name: 'Finalizar Configuración' }).click();

      await expect(page).toHaveURL(/\/admin$/);
      await expect(page.getByRole('heading', { name: nombre })).toBeVisible({ timeout: 30000 });

      // 2. Seed del directorio de clientes (lo que escribe el backend al agendar)
      const haceTresDias = new Date(Date.now() - 3 * 86400000);
      const hoy = new Date();
      await db.collection('clientes').doc(`${slug}__573001111111`).set({
        negocio_id: slug,
        cliente_phone: '+573001111111',
        client_name: 'Pepito Prueba',
        visits: 3,
        total_spent: 90000,
        last_seen: haceTresDias,
      });
      await db.collection('clientes').doc(`${slug}__573002222222`).set({
        negocio_id: slug,
        cliente_phone: '+573002222222',
        client_name: 'Juanita Prueba',
        visits: 1,
        total_spent: 45000,
        last_seen: hoy,
      });
      await db.collection('clientes').doc(`${slug}__573003333333`).set({
        negocio_id: slug,
        cliente_phone: '+573003333333',
        client_name: 'Sin Visitas',
        visits: 0,
        total_spent: 0,
        last_seen: null,
      });

      // 3. El panel el directorio CRM en vivo
      await expect(page.getByText('Directorio de Clientes (CRM)')).toBeVisible({ timeout: 15000 });

      // Contador de clientes totales (3 docs sembrados)
      await expect(page.getByText('3 Clientes Totales')).toBeVisible();

      // Pepito: 3 visitas y LTV $90.000 (es-CO => 90.000), su última visita hace 3 días
      const filaPepito = page.locator('tbody tr', { hasText: 'Pepito Prueba' });
      await expect(filaPepito).toBeVisible();
      await expect(filaPepito).toContainText('$90.000');
      await expect(filaPepito).toContainText('3');
      await expect(filaPepito).toContainText('Hace 3 días');

      // Juanita: 1 visita y LTV $45.000, última visita hoy
      const filaJuanita = page.locator('tbody tr', { hasText: 'Juanita Prueba' });
      await expect(filaJuanita).toContainText('$45.000');
      await expect(filaJuanita).toContainText('Hoy');

      // Orden: el más leal (más visitas) aparece primero en la tabla
      await expect(page.locator('tbody tr').first()).toContainText('Pepito Prueba');

      // Los enlaces de WhatsApp apuntan al número E.164 de cada cliente
      const linkPepito = filaPepito.locator('a[href]').first();
      await expect(linkPepito).toHaveAttribute('href', /wa\.me\/.*573001111111/);
      await expect(filaJuanita.locator('a[href]').first()).toHaveAttribute(
        'href',
        /wa\.me\/.*573002222222/,
      );
    } finally {
      // Limpieza del entorno de prueba (negocio + subcolecciones + reservas + cuenta Auth)
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