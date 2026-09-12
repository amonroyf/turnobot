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
VITE_API_URL=https://turnobot-850305350371.us-central1.run.app npm run build   # genera dist/
```

Despliegue a Firebase Hosting desde la raíz: `ENV_FILE=... ./deploy.sh only-frontend`.

## Componentes Principales

| Archivo | Descripción |
|---------|-------------|
| `BookingApp.jsx` | Flujo de reserva del cliente (5 pasos, calendario, auto-scroll) |
| `AdminDashboard.jsx` | Panel admin (Agenda, Clientes CRM, Ajustes, Horarios, No-Show) |
| `MisCitas.jsx` | Consulta y cancelación de citas del cliente |
| `firebase.js` | Configuración de Firebase (Auth, Firestore) |

## Tests E2E (Playwright)

```bash
cd frontend
npx playwright test                    # suite completa (requiere backend en :8080)
npx playwright test e2e-tests/horarios.spec.js
API_BASE=https://turnobot-ehomyvoh6q-uc.a.run.app npx playwright test e2e-tests/reglas-negocio.spec.js
```

Los specs `horarios` y `reglas-negocio` validan el motor de turnos por empleado y las reglas de negocio contra el backend.

### Aislamiento de staging

Todos los datos de pruebas usan slugs con prefijo `e2e-` (o `E2E_SLUG_PREFIX`
personalizado). JAMÁS crean ni tocan negocios reales.

```bash
npm run test:e2e:clean                          # dry-run: lista lo borrable
npm run test:e2e:clean -- --yes                 # borra datos e2e
npm run test:e2e:clean -- --yes --include-legacy  # + basura histórica (revisar lista antes)
E2E_SLUG_PREFIX=qa npm run test:e2e:clean -- --yes  # otro prefijo
PLAYWRIGHT_BASE_URL=http://localhost:5174 npx playwright test  # otro front
```

Los usuarios de Auth de pruebas se borran por test (`limpiarEntornoReal`); el
script de limpieza no los toca (no se pueden listar por slug).
