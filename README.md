# Turnobot — Agendamiento web para salones / barberías

Aplicación web para reservas de citas, con sincronización automática a Google Calendar por empleado.

## Arquitectura

- **Backend (Go):** API REST + OAuth por empleado + sincronización con Google Calendar.
- **Frontend (React + Vite + Tailwind):** app móvil-first de reservas.
- **Persistencia:** Google Firestore.
- **Producción:** backend en Cloud Run, frontend en Firebase Hosting / Vercel / Netlify.

## Repositorio

- `turnobot/` — backend Go (`main.go`, `seed.go`, `Dockerfile`, `go.mod`, `go.sum`).
- `frontend/` — código del sitio web (`src/`, `public/`, `vite.config.js`).
- `.env.example` — plantilla de variables (no incluir `.env` en Git).

## Despliegue backend

Requiere las siguientes variables de entorno:

- `GCP_PROJECT_ID`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `REDIRECT_URL`
- `FRONTEND_URL` (opcional; default `http://localhost:5173`)

El `Dockerfile` usa una imagen base con `tzdata` para zona horaria correcta en Cloud Run.

Ver `turnobot/` para el código fuente.

## Seed de datos de prueba

Desde `turnobot/`:

  go run seed.go

Esto popula Firestore con un negocio de ejemplo (`barberia-vip`), servicios y empleados.

## Frontend

Desde `frontend/`:

  npm install
  npm run dev

Para producción, compilar con la variable de entorno que apunte a tu backend:

  VITE_API_URL=https://turnobot-xxxx.run.app npm run build

El resultado va en `frontend/dist/`.

## Flujo de OAuth por empleado

Cada empleado vincula su propio Google Calendar:

  https://turnobot-xxxx.run.app/auth/google/login?negocio_id={slug}&emp_id={emp_id}

El `state` transporta `negocio_id|emp_id` para guardar el refresh token en Firestore bajo el empleado correcto.

## Varios tenant y galpones

- Un tenant = un negocio identificado por slug.
- El mismo backend atiende múltiples tenant; la discriminación es por slug en la URL `/api/v1/b/{slug}/...`.
- Varios galpones físicos: la arquitectura actual opera por empleado; si necesitas agenda/capacidad separada por sucursal, hay que extender la data model y la lógica de slots (ver notas internas si las hay).

## Estado de seguridad

- No se almacenan secretos en este repo (solo `.env.example`).
- El binario compilado `turnobot/turnobot` no se versiona.
- `frontend/node_modules/`, `frontend/dist/` y `frontend/package-lock.json` no se versionan.
