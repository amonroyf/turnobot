import { test, expect } from '@playwright/test';
import { db, limpiarEntornoReal, e2eSlug } from './setup.js';

test.setTimeout(120_000);

// ─────────────────────────────────────────────────────────────────────────────
// HARNESS del módulo CRM ("Directorio de Clientes")
// ─────────────────────────────────────────────────────────────────────────────
// Verifica que el panel del dueño lea la colección clientes (mantenida por el
// backend) y muestre en tarjetas móviles: nombre, WhatsApp, LTV, visitas y
// última visita (respaldada en last_date_str, en zona del negocio).
test.describe('Directorio de Clientes (CRM)', () => {
  test('Muestra el historial de clientes con LTV y última visita', async ({ page }) => {
    const ts = Date.now();
    const nombre = `Cliente QA ${ts}`;
    const email = `crm${ts}@turnobot.test`;
    const slug = e2eSlug(nombre.toLowerCase().trim().replace(/[\s\W-]+/g, '-'));

    // Las tarjetas de clientes (CRM) se distinguen de las de reservas por el
    // marcador "LTV" y viven dentro de una tajeta blanca contenedora.
    const tarjetaCliente = (nombreCliente) =>
      page.locator('div.rounded-2xl', { hasText: 'LTV' }).filter({ hasText: nombreCliente });

    try {
      // 1. Registro del local (crea el negocio y la sesión del dueño en el navegador)
      await page.goto('/register');
      await page.getByText('¿Prefieres crear tu cuenta con correo y contraseña?').click();
      await page.locator('input[type="email"]').fill(email);
      await page.locator('input[type="password"]').fill('Clave.123');
      await page.getByRole('button', { name: 'Crear cuenta con correo' }).click();

      await expect(page.getByPlaceholder('Ej. Clínica Wellness / Auto Detailing')).toBeVisible();
      await page.getByPlaceholder('Ej. Clínica Wellness / Auto Detailing').fill(nombre);
      // Usar slug con prefijo e2e antes de finalizar (aislamiento de staging)
      await page.locator('input[type="text"]').nth(1).fill(slug);
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

      // 3. El panel muestra el directorio CRM en vivo (contador = 3 clientes)
      await expect(
        page.getByRole('heading', { name: /Directorio de Clientes \(3\)/ }),
      ).toBeVisible({ timeout: 15000 });

      // Pepito: 3 visitas, LTV $90.000 (es-CO => 90.000) y la fecha de su turno
      // más reciente viene del respaldo legible en zona del negocio (last_date_str)
      const tarjetaPepito = tarjetaCliente('Pepito Prueba');
      await expect(tarjetaPepito).toBeVisible();
      await expect(tarjetaPepito).toContainText('$90.000');
      await expect(tarjetaPepito).toContainText('3 visitas');
      await expect(tarjetaPepito).toContainText(/1 sept?\.?\s*2026/);

      // Juanita: 1 visita, LTV $45.000 y su fecha también viene de last_date_str
      const tarjetaJuanita = tarjetaCliente('Juanita Prueba');
      await expect(tarjetaJuanita).toContainText('$45.000');
      await expect(tarjetaJuanita).toContainText('1 visitas');
      await expect(tarjetaJuanita).toContainText(/4 sept?\.?\s*2026/);

      // Sin last_seen ni last_date_str -> "N/A"
      const tarjetaSinVisitas = tarjetaCliente('Sin Visitas');
      await expect(tarjetaSinVisitas).toContainText('N/A');

      // Orden: el más leal (más visitas) aparece primero en las tarjetas
      await expect(page.locator('div.rounded-2xl', { hasText: 'LTV' }).first()).toContainText(
        'Pepito Prueba',
      );

      // Los enlaces de WhatsApp apuntan al número E.164 de cada cliente
      const linkPepito = tarjetaPepito.locator('a[href]').first();
      await expect(linkPepito).toHaveAttribute('href', /wa\.me\/.*573001111111/);
      await expect(tarjetaJuanita.locator('a[href]').first()).toHaveAttribute(
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