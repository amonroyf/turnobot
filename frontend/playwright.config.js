import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-tests',
  fullyParallel: true,
  retries: 1,
  workers: 1, // 1 worker para evitar colisiones en la tienda estática de pruebas
  globalSetup: './e2e-tests/global-setup.js',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173', // Frontend en desarrollo (Vite + proxy /api -> backend local)
    channel: 'chrome',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});