# Turnobot — Agendamiento web para salones / barberías

Aplicación web para reservas de citas, con sincronización automática a Google Calendar por empleado.

## Estructura

- `backend/` — API REST en Go (Cloud Run). Ver `backend/README.md`.
- `frontend/` — app web en React + Vite + Tailwind (Firebase Hosting). Ver `frontend/README.md`.
- `firestore.rules` — reglas de seguridad de Firestore (lectura pública del catálogo, escritura de horarios solo el dueño con formato válido, reservas/CRM según rol).
- `scripts/` — despliegue de Hosting (`deploy-hosting.mjs`) y de reglas (`deploy-rules.mjs`).
- `deploy.sh` — despliegue completo (backend + frontend). Ver abajo.

## Despliegue

```bash
ENV_FILE=/ruta/a/env_full.yaml ./deploy.sh              # todo
ENV_FILE=... ./deploy.sh only-backend                    # solo Cloud Run
ENV_FILE=... ./deploy.sh only-frontend                   # solo Hosting
TOKEN=$(gcloud auth print-access-token) node scripts/deploy-rules.mjs  # solo reglas
```

El `ENV_FILE` es un YAML con las variables del backend (ver `backend/.env.example`).
No se versiona por contener secretos. Requiere `gcloud` autenticado.

## Flujo de OAuth por empleado

Cada empleado vincula su propio Google Calendar:

  https://turnobot-xxxx.run.app/auth/google/login?negocio_id={slug}&emp_id={emp_id}

El `state` transporta `negocio_id|emp_id` para guardar el refresh token en Firestore bajo el empleado correcto.

## Multi-tenant

- Un tenant = un negocio identificado por slug.
- El mismo backend atiende múltiples tenant; la discriminación es por slug en la URL `/api/v1/b/{slug}/...`.

## Seguridad

- No se almacenan secretos en este repo (solo `*.env.example`).
- El binario compilado (`backend/turnobot`), `frontend/node_modules/`, `frontend/dist/` y `frontend/package-lock.json` no se versionan.
