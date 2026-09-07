import { test, expect } from '@playwright/test';
import { db } from './setup.js';

test.setTimeout(120_000);

test.describe('Register + Admin Panel', () => {
  // Sin sesión: /admin muestra el login con Google
  test('Admin sin sesión: muestra el botón de Iniciar Sesión con Google', async ({ page }) => {
    await page.goto('/admin');
    await expect(
      page.getByRole('button', { name: 'Iniciar Sesión con Google' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Turnobot Admin' })).toBeVisible();
  });

  // Registro de local + panel: crea la cuenta y llega al dashboard
  test('Registro exitoso lleva al panel y permite crear servicio y profesional', async ({
    page,
  }) => {
    const ts = Date.now();
    const nombre = `Barberia QA ${ts}`;
    const email = `qa${ts}@turnobot.test`;
    const slug = nombre.toLowerCase().trim().replace(/[\s\W-]+/g, '-');

    await page.goto('/register');
    await page.getByText('¿Prefieres crear tu cuenta con correo y contraseña?').click();
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill('Clave.123');
    await page.getByRole('button', { name: 'Crear cuenta con correo' }).click();

    // Paso 2: nombre del local (el slug se genera solo) y finalizar
    await expect(page.getByPlaceholder('Ej. Barbería VIP')).toBeVisible();
    await page.getByPlaceholder('Ej. Barbería VIP').fill(nombre);
    await expect(page.locator('input[type="text"]').nth(1)).toHaveValue(slug);
    await page.getByRole('button', { name: 'Finalizar Configuración' }).click();

    // Redirige al panel y carga el negocio recién creado
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: nombre })).toBeVisible({
      timeout: 30000,
    });

    // El documento existe en Firestore con el owner_uid
    const negocio = await db.collection('negocios').doc(slug).get();
    expect(negocio.exists).toBe(true);
    expect(negocio.data().owner_uid).toBeTruthy();

    // Crear un servicio desde el panel
    await page.getByPlaceholder('Nombre (ej. Corte clásico)').fill('Corte Tradicional');
    await page.getByPlaceholder('Minutos').fill('30');
    await page.getByPlaceholder('Precio').fill('25000');
    await page.getByRole('button', { name: 'Guardar Servicio' }).click();
    await expect(page.getByText('Corte Tradicional')).toBeVisible({
      timeout: 20000,
    });

    // Crear un profesional desde el panel
    await page.getByPlaceholder('Nombre del profesional').fill('Pepe');
    await page.getByRole('button', { name: 'Añadir Profesional' }).click();
    await expect(page.getByText('Pepe')).toBeVisible({ timeout: 20000 });

    // Verificar en Firestore las subcolecciones
    const servicios = await db.collection('negocios').doc(slug).collection('servicios').get();
    expect(servicios.empty).toBe(false);
    const empleados = await db.collection('negocios').doc(slug).collection('empleados').get();
    expect(empleados.empty).toBe(false);

    // Eliminar el profesional desde el panel (botón "Eliminar")
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Eliminar profesional Pepe' }).click();
    await expect(page.getByText('Pepe')).toBeHidden({ timeout: 15000 });

    // Eliminar el servicio desde el panel (icono de papelera)
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Eliminar servicio Corte Tradicional' }).click();
    await expect(page.getByText('Corte Tradicional')).toBeHidden({ timeout: 15000 });

    // Limpieza: el usuario/negocio de prueba no se borra (cuenta Auth) pero sí el negocio
    await db.collection('negocios').doc(slug).delete();
    const servicioDoc = servicios.docs[0];
    const empleadoDoc = empleados.docs[0];
    await db.collection('negocios').doc(slug).collection('servicios').doc(servicioDoc.id).delete();
    await db.collection('negocios').doc(slug).collection('empleados').doc(empleadoDoc.id).delete();
  });

  // Slug ya en uso: debe mostrar error y no navegar
  test('Registro con slug ya en uso muestra error', async ({ page }) => {
    await page.goto('/register');
    await page.getByText('¿Prefieres crear tu cuenta con correo y contraseña?').click();
    await page.locator('input[type="email"]').fill(`dupe${Date.now()}@turnobot.test`);
    await page.locator('input[type="password"]').fill('Clave.123');
    await page.getByRole('button', { name: 'Crear cuenta con correo' }).click();

    // Paso 2: forzar un slug existente manualmente
    const nombre = 'Barberia VIP Duplicada';
    await page.getByPlaceholder('Ej. Barbería VIP').fill(nombre);
    await page.locator('input[type="text"]').nth(1).fill('barberia-vip');
    await page.getByRole('button', { name: 'Finalizar Configuración' }).click();

    await expect(page.getByText('Este enlace ya está en uso. Por favor, elige otro.')).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
  });
});