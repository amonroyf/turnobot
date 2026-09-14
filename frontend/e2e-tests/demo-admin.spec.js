import { test, expect } from '@playwright/test';
import { adminAuth, db } from './setup.js';

const timestamp = Date.now();
const email = `demo-admin-${timestamp}@turnobot.test`;
const slug = 'barberia-vip';
const password = 'Clave.123';
let uid;
let originalOwnerUid;

test.beforeAll(async () => {
  const negocioRef = db.collection('negocios').doc(slug);
  const negocio = await negocioRef.get();
  originalOwnerUid = negocio.data()?.owner_uid;
});

test.afterAll(async () => {
  await db.collection('negocios').doc(slug).update({ owner_uid: originalOwnerUid || 'e2e-owner' });
  await adminAuth.deleteUser(uid).catch(() => {});
});

test('Grabar módulos del panel Admin con sesión demo', async ({ page }) => {
  test.setTimeout(60000);

  await page.goto('/register');
  await page.getByRole('button', { name: /crear tu cuenta con correo y contraseña/i }).click();
  await page.getByPlaceholder('Correo electrónico').fill(email);
  await page.getByPlaceholder('Contraseña (mínimo 6 caracteres)').fill(password);
  await page.getByRole('button', { name: 'Crear cuenta con correo' }).click();
  await expect(page.getByText('Sesión iniciada. Solo falta configurar tu negocio.')).toBeVisible({ timeout: 30000 });

  const user = await adminAuth.getUserByEmail(email);
  uid = user.uid;
  await db.collection('negocios').doc(slug).update({ owner_uid: uid });
  await page.goto('/admin');

  await expect(page.getByRole('heading', { name: /Barberia VIP/i })).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: 'test-results/demo-barberia-vip-agenda.png', fullPage: true });
  await page.waitForTimeout(1500);

  await page.getByRole('button', { name: 'Clientes' }).click();
  await expect(page.getByText(/Directorio de Clientes/)).toBeVisible();
  await page.screenshot({ path: 'test-results/demo-barberia-vip-clientes.png', fullPage: true });
  await page.waitForTimeout(1500);

  await page.getByRole('button', { name: 'Ajustes' }).click();
  await expect(page.getByText('Información del Local')).toBeVisible();
  await page.screenshot({ path: 'test-results/demo-barberia-vip-ajustes.png', fullPage: true });

  await page.waitForTimeout(3000);
});
