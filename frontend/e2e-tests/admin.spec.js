import { test, expect } from '@playwright/test';
import { db, adminAuth, e2eSlug, crearUsuarioYTema, signInWithCustomToken } from './setup.js';

test.setTimeout(300_000);

test.describe('Register + Admin Panel', () => {
  test('Admin sin sesión: muestra el botón de Iniciar Sesión con Google', async ({ page }) => {
    await page.goto('/admin');
    await expect(
      page.getByRole('button', { name: 'Iniciar Sesión con Google' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Turnobot Admin' })).toBeVisible();
  });

  test('Registro exitoso lleva al panel y permite crear servicio y profesional', async ({
    page,
  }) => {
    const ts = Date.now();
    const nombre = `Negocio QA ${ts}`;
    const email = `qa${ts}@turnobot.test`;
    const slugAuto = nombre.toLowerCase().trim().replace(/[\s\W-]+/g, '-');
    const slug = e2eSlug(slugAuto);

    const { email: userEmail, password } = await crearUsuarioYTema(email, nombre, slug);

    await page.goto('/register');
    await signInWithCustomToken(page, userEmail, password);
    await page.goto('/admin');

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: nombre })).toBeVisible({
      timeout: 30000,
    });

    const negocio = await db.collection('negocios').doc(slug).get();
    expect(negocio.exists).toBe(true);
    expect(negocio.data().owner_uid).toBeTruthy();

    await page.getByPlaceholder('Nombre (ej. Consulta, Limpieza, Terapia)').fill('Consulta Tradicional');
    await page.getByPlaceholder('Minutos').fill('30');
    await page.getByPlaceholder('Precio').fill('25000');
    await page.getByRole('button', { name: /Agregar Servicio/ }).click();
    await expect(page.getByText('Consulta Tradicional')).toBeVisible({
      timeout: 20000,
    });

    await page.getByPlaceholder('Nombre del profesional').fill('Pepe');
    await page.getByRole('button', { name: 'Añadir Profesional' }).click();
    await expect(page.getByText('Pepe')).toBeVisible({ timeout: 20000 });

    await expect
      .poll(
        async () =>
          (await db.collection('negocios').doc(slug).collection('servicios').get()).empty,
      )
      .toBe(false);
    const servicios = await db.collection('negocios').doc(slug).collection('servicios').get();
    await expect
      .poll(
        async () =>
          (await db.collection('negocios').doc(slug).collection('empleados').get()).empty,
      )
      .toBe(false);
    const empleados = await db.collection('negocios').doc(slug).collection('empleados').get();

    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Eliminar profesional Pepe' }).click();
    await expect(page.getByText('Pepe')).toBeHidden({ timeout: 15000 });

    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Eliminar servicio Consulta Tradicional' }).click();
    await expect(page.getByText('Consulta Tradicional')).toBeHidden({ timeout: 15000 });

    await db.collection('negocios').doc(slug).delete();
    const servicioDoc = servicios.docs[0];
    const empleadoDoc = empleados.docs[0];
    await db.collection('negocios').doc(slug).collection('servicios').doc(servicioDoc.id).delete();
    await db.collection('negocios').doc(slug).collection('empleados').doc(empleadoDoc.id).delete();
    const userRecord = await adminAuth.getUserByEmail(email);
    await adminAuth.deleteUser(userRecord.uid).catch(() => {});
  });

  test('Registro con slug ya en uso muestra error', async ({ page }) => {
    const ts = Date.now();
    const email = `dupe${ts}@turnobot.test`;
    const slug = 'mi-negocio';

    const { email: userEmail, password } = await crearUsuarioYTema(email, 'Usuario Dupe', `e2e-dupe-${ts}`);

    await page.goto('/register');
    await signInWithCustomToken(page, userEmail, password);
    await page.goto('/admin');
    await page.goto('/register');

    await page.getByPlaceholder('Ej. Clínica Wellness / Auto Detailing').fill('Mi Negocio Duplicada');
    await page.locator('input[type="text"]').nth(1).fill(slug);
    await page.getByRole('button', { name: 'Finalizar Configuración' }).click();

    await expect(page.getByText('Este enlace ya está en uso. Por favor, elige otro.')).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);

    await db.collection('negocios').doc(slug).delete().catch(() => {});
    const userRecord = await adminAuth.getUserByEmail(email);
    await adminAuth.deleteUser(userRecord.uid).catch(() => {});
  });
});
