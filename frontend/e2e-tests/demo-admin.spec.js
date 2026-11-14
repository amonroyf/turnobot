import { test, expect } from '@playwright/test';
import { adminAuth, db, signInEnPagina, crearUsuarioE2E } from './setup.js';

const email = `demo-admin-${Date.now()}@turnobot.test`;
const slug = 'mi-negocio';
let uid;
let originalOwnerUid;

test.beforeAll(async () => {
  const negocioRef = db.collection('negocios').doc(slug);
  const negocio = await negocioRef.get();
  originalOwnerUid = negocio.data()?.owner_uid;

  await crearUsuarioE2E(email);
  const user = await adminAuth.getUserByEmail(email);
  uid = user.uid;
  await negocioRef.update({ owner_uid: uid });
});

test('Grabar módulos del panel Admin con sesión demo', async ({ page }) => {
  test.setTimeout(60000);

  await page.goto('/register');
  await signInEnPagina(page, email, 'Clave.123');
  await page.goto('/admin');

  await expect(page.getByRole('heading', { name: /Mi Negocio Demo/i })).toBeVisible({
    timeout: 30000,
  });
  await page.screenshot({ path: 'test-results/demo-mi-negocio-agenda.png', fullPage: true });
  await page.waitForTimeout(1500);

  await page.getByRole('button', { name: 'Clientes' }).click();
  await expect(page.getByText(/Directorio de Clientes/)).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: 'test-results/demo-mi-negocio-clientes.png', fullPage: true });
  await page.waitForTimeout(1500);

  await page.getByRole('button', { name: 'Ajustes' }).click();
  await expect(page.getByText('Datos de tu página pública')).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: 'test-results/demo-mi-negocio-ajustes.png', fullPage: true });
  await page.waitForTimeout(3000);
});

test.afterAll(async () => {
  await db
    .collection('negocios')
    .doc(slug)
    .update({ owner_uid: originalOwnerUid || 'e2e-owner' })
    .catch(() => {});
  if (uid) await adminAuth.deleteUser(uid).catch(() => {});
});
