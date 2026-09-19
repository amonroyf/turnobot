import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-tests',
  fullyParallel: true,
  retries: 1,
  workers: 1, // 1 worker para evitar colisiones en la tienda estática de pruebas
  globalSetup: './e2e-tests/global-setup.js',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173', // Frontend en desarrollo (Vite + proxy /api -> backend local)
    trace: 'on-first-retry',
    video: 'on',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
  ],
  webServer: {
    command: 'cd .. && cd frontend && npx vite --host',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30000,
  },
});