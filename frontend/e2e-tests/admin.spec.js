import { test, expect } from '@playwright/test';
import {
  API_BASE,
  db,
  adminAuth,
  e2eSlug,
  crearUsuarioYTema,
  signInEnPagina,
} from './setup.js';

test.setTimeout(300_000);

test.describe('Register + Admin Panel', () => {
  test('Admin sin sesión: muestra el botón de Iniciar Sesión con Google', async ({ page }) => {
    await page.goto('/admin');
    await expect(
      page.getByRole('button', { name: 'Iniciar Sesión con Google' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Panel del Negocio' })).toBeVisible();
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
    await signInEnPagina(page, userEmail, password);
    await page.goto('/admin');

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: nombre })).toBeVisible({
      timeout: 30000,
    });

    const negocio = await db.collection('negocios').doc(slug).get();
    expect(negocio.exists).toBe(true);
    expect(negocio.data().owner_uid).toBeTruthy();

    await page.getByRole('button', { name: 'Ajustes' }).click();
    await page.getByPlaceholder('Ej. Corte, Uñas, Limpieza').fill('Consulta Tradicional');
    await page.getByPlaceholder('Ej. 30', { exact: true }).fill('30');
    await page.getByPlaceholder('Ej. 20000', { exact: true }).fill('25000');
    await page.getByRole('button', { name: /Agregar Servicio/ }).click();
    await expect(page.getByText('Consulta Tradicional')).toBeVisible({
      timeout: 20000,
    });

    await page.getByPlaceholder('Ej. Camila, Andrés…').fill('Pepe');
    await page.getByRole('button', { name: /Añadir al equipo/ }).click();
    await expect(page.getByText('Pepe').first()).toBeVisible({ timeout: 20000 });

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

    await page.getByLabel('Quitar a Pepe del equipo').click();
    await page.getByRole('button', { name: 'Sí, quitar' }).click();
    await expect(page.getByText('Pepe').first()).toBeHidden({ timeout: 15000 });

    await page.getByLabel('Eliminar servicio Consulta Tradicional').click();
    await page.getByRole('button', { name: 'Sí, eliminar' }).click();
    await expect(page.getByText('Consulta Tradicional')).toBeHidden({ timeout: 15000 });

    await db.collection('negocios').doc(slug).delete();
    const servicioDoc = servicios.docs[0];
    const empleadoDoc = empleados.docs[0];
    await db.collection('negocios').doc(slug).collection('servicios').doc(servicioDoc.id).delete();
    await db.collection('negocios').doc(slug).collection('empleados').doc(empleadoDoc.id).delete();
    const userRecord = await adminAuth.getUserByEmail(email);
    await adminAuth.deleteUser(userRecord.uid).catch(() => {});
  });

  test('Registro con slug ya en uso: la API reporta mi-negocio como ocupado', async () => {
    const res = await fetch(`${API_BASE}/api/v1/b/mi-negocio/existe`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.exists).toBe(true);

    const libre = await fetch(`${API_BASE}/api/v1/b/e2e-slug-libre-${Date.now()}/existe`);
    expect(libre.ok).toBe(true);
    const libreBody = await libre.json();
    expect(libreBody.exists).toBe(false);
  });
});
