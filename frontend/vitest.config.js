import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.js', 'src/**/*.test.jsx'],
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test-setup.js'],
  },
});