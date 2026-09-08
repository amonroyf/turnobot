# Turnobot frontend (React + Vite + Tailwind)

App móvil-first de reservas (`src/`, `public/`, `vite.config.js`).

## Desarrollo

```bash
cd frontend
npm install
npm run dev            # :5173, con proxy /api -> backend en :8080
```

## Producción

```bash
VITE_API_URL=https://turnobot-xxxx.run.app npm run build   # genera dist/
```

Despliegue a Firebase Hosting desde la raíz: `ENV_FILE=... ./deploy.sh only-frontend`.

## Tests E2E (Playwright)

```bash
cd frontend
npx playwright test                    # suite completa (requiere backend en :8080)
npx playwright test e2e-tests/horarios.spec.js
API_BASE=https://turnobot-xxxx.run.app npx playwright test e2e-tests/reglas-negocio.spec.js
```

Los specs `horarios` y `reglas-negocio` validan el motor de turnos por empleado y las reglas de negocio contra el backend.
