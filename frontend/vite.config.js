import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// El proxy de /api apunta al backend Go en local (solo se usa en desarrollo
// cuando VITE_API_URL está vacío y el frontend usa rutas relativas).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
});