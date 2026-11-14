import { defineConfig, devices } from '@playwright/test';
import { IS_GCP, PROJECT_ID, TARGET, WEB_BASE } from './e2e-tests/target.js';

// Specs que necesitan Auth real + Admin SDK sobre el mismo proyecto. En local
// el frontend usa el proyecto real pero el Admin SDK usa el emulador, así que
// no están alineados; se habilitan en modo GCP.
const SPECS_SOLO_GCP = [
  '**/admin.spec.js',
  '**/booking.spec.js',
  '**/crm.spec.js',
  '**/demo-admin.spec.js',
  '**/demo-reserva.spec.js',
  '**/multi-tenant.spec.js',
  '**/real-flow.spec.js',
  '**/reglas-negocio.spec.js',
  '**/smoke-prod.spec.js',
  '**/visual.spec.js',
];

export default defineConfig({
  testDir: './e2e-tests',
  fullyParallel: true,
  retries: 1,
  workers: 1, // 1 worker para evitar colisiones en la tienda estática de pruebas
  globalSetup: './e2e-tests/global-setup.js',
  testIgnore: IS_GCP ? [] : SPECS_SOLO_GCP,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['allure-playwright', { outputFolder: 'allure-results' }],
  ],
  use: {
    baseURL: WEB_BASE,
    trace: 'on-first-retry',
    video: 'on',
  },
  metadata: {
    target: TARGET,
    projectId: PROJECT_ID,
    webBase: WEB_BASE,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
  ],
  // En modo GCP se prueban los servicios desplegados: no se levanta Vite.
  webServer: IS_GCP
    ? undefined
    : {
        command: 'npm run dev -- --host',
        url: WEB_BASE,
        reuseExistingServer: true,
        timeout: 30000,
        cwd: '.',
      },
});
