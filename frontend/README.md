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
| `pushNotifications.js` | Registro de push y escucha de mensajes FCM |

## Notificaciones Push

El frontend registra automáticamente el token FCM del dueño al iniciar sesión:

1. Se solicita permiso de notificación al navegador
2. Se obtiene el token FCM
3. Se guarda en Firestore (`negocios.push_token`)
4. Se escuchan mensajes entrantes y se muestran como alerta

## Tests E2E (Playwright)

```bash
cd frontend
npx playwright test                    # suite completa (requiere backend en :8080)
npx playwright test e2e-tests/horarios.spec.js
API_BASE=https://turnobot-850305350371.us-central1.run.app npx playwright test e2e-tests/reglas-negocio.spec.js
```

Los specs `horarios` y `reglas-negocio` validan el motor de turnos por empleado y las reglas de negocio contra el backend.
