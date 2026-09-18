# Turnobot — Agendamiento web para salones / barberías

Aplicación web para reservas de citas, con sincronización automática a Google Calendar por empleado.

## Estructura

- `backend/` — API REST en Go (Cloud Run). Ver `backend/README.md`.
- `frontend/` — app web en React + Vite + Tailwind (Firebase Hosting). Ver `frontend/README.md`.
- `firestore.rules` — reglas de seguridad de Firestore.
- `firestore.indexes.json` — índices compuestos de Firestore.
- `scripts/` — despliegues, reglas y backup manual de Firestore.
- `deploy.sh` — despliegue completo (backend + frontend).

## URLs de Producción

| Servicio | URL |
|----------|-----|
| Backend API | https://turnobot-850305350371.us-central1.run.app |
| Frontend | https://turnobot-web.web.app |
| Firebase Project | stalwart-coast-439901-d0 |

## Despliegue

> 📖 **Guía completa de despliegue:** Ver [DEPLOY.md](DEPLOY.md)

```bash
ENV_FILE=/ruta/a/env_full.yaml ./deploy.sh              # todo
ENV_FILE=... ./deploy.sh only-backend                    # solo Cloud Run
ENV_FILE=... ./deploy.sh only-frontend                   # solo Hosting
TOKEN=$(gcloud auth print-access-token) node scripts/deploy-rules.mjs  # solo reglas
TOKEN=$(gcloud auth print-access-token) firebase --project stalwart-coast-439901-d0 deploy --only firestore:indexes  # solo índices
```

## Endpoints API

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/health` | GET | Health check (verifica Firestore) |
| `/api/v1/b/{slug}` | GET | Datos del negocio, servicios y empleados |
| `/api/v1/b/{slug}/slots` | GET | Horarios disponibles para un empleado/fecha (`emp_id=any` = todos) |
| `/api/v1/b/{slug}/slots/primer-hueco` | GET | Primer horario libre hacia adelante |
| `/api/v1/b/{slug}/book` | POST | Crear reserva (Firestore + Google Calendar + push al dueño y empleado) |
| `/api/v1/b/{slug}/citas` | GET | Citas activas del cliente por teléfono |
| `/api/v1/b/{slug}/citas/{id}` | DELETE | Cancelar cita (cliente solo con 2h+; dueño y equipo siempre) |
| `/api/v1/b/{slug}/citas/{id}/reschedule` | POST | Mover cita de día/hora (misma cita, mueve Calendar) |
| `/api/v1/b/{slug}/citas/{id}/undo` | POST | Deshacer cancelación/no-show del mismo día (recrea el Calendar) |
| `/api/v1/b/{slug}/citas/{id}/client-push-token` | POST | Registrar token del cliente para su recordatorio |
| `/api/v1/b/{slug}/no-show/{id}` | POST | Marcar cita como no-show (solo pasadas) |
| `/api/v1/b/{slug}/servicios/{id}` | DELETE | Eliminar servicio (en cascada) |
| `/api/v1/b/{slug}/empleados/{id}` | DELETE | Eliminar empleado (en cascada) |
| `/api/v1/b/{slug}/empleados/{id}/pin` | POST | Asignar PIN al empleado (dueño) |
| `/api/v1/b/{slug}/employee-login` | POST | Login del empleado con PIN (token 12h) |
| `/api/v1/b/{slug}/employee/{id}/citas` | GET | Citas del empleado |
| `/api/v1/b/{slug}/employee/{id}/register-push-token` | POST | Registrar push del empleado |
| `/api/v1/b/{slug}/employee/{id}/push-token` | DELETE | Baja de push del empleado |
| `/api/v1/b/{slug}/register-push-token` | POST | Registrar push del dueño |
| `/api/v1/b/{slug}/push-token` | DELETE | Baja de push del dueño |
| `/api/v1/b/{slug}/push-test` | POST | Push de prueba a los dispositivos del dueño |
| `/api/v1/b/{slug}/cache/invalidate` | POST | Limpiar caché en RAM del negocio |
| `/api/v1/check-reminders` | POST | Cron cada 15 min: recordatorios a clientes + resumen al dueño (header `X-Cron-Secret`) |
| `/api/v1/push-ping` | POST | Telemetría de recepción push (diagnóstico) |
| `/auth/google/login` | GET | Iniciar OAuth de Google Calendar |
| `/auth/google/callback` | GET | Callback OAuth |

## No-Show

| Archivo | Descripción |
|---------|-------------|
| `backend/noshow.go` | Handler HTTP: markNoShow (marca `no_show` + ajuste CRM transaccional + push al cliente) |

### Flujo

1. **Dueño o empleado asignado marca "No Llegó"** (solo citas pasadas) → Reserva se marca como `no_show: true`, se ajusta el CRM y se avisa al cliente por push

## Firestore Indexes

Índices compuestos desplegados:

| Colección | Campos | Uso |
|-----------|--------|-----|
| reservas | negocio_id + emp_id + date_time | Cálculo de slots disponibles |
| reservas | user_phone + negocio_id + date_time | Listado de citas del cliente + anti-spam |

## Seguridad

- **Firestore Rules**: Escritura de reservas solo desde el backend Go (`create: if false`)
- **Lectura por owner_uid**: Reservas y clientes se leen validando `resource.data.owner_uid == request.auth.uid`
- **Límite anti-spam**: Máximo 3 citas por teléfono por día natural
- **No overlap**: Clientes pueden agendar múltiples citas (familias/grupos)

## Variables de Entorno Requeridas

| Variable | Descripción |
|----------|-------------|
| `GCP_PROJECT_ID` | ID del proyecto GCP (default: stalwart-coast-439901-d0) |
| `GOOGLE_CLIENT_ID` | Client ID de Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Client Secret de Google OAuth |
| `REDIRECT_URL` | URL de callback OAuth |
| `CRON_SECRET` | Secreto del cron `check-reminders` (header `X-Cron-Secret`) |
| `EMPLOYEE_TOKEN_KEY` | Firma de sesiones de empleado, mín 32 chars (requerida: sin esto no arranca) |
| `FRONTEND_URL` | URL pública del frontend (links y CORS) |
| `PORT` | Puerto del servidor (default: 8080) |

## Multi-tenant

- Un tenant = un negocio identificado por slug
- El mismo backend atiende múltiples tenants; la discriminación es por slug en la URL
- Cada negocio tiene su propio calendario, empleados, servicios y clientes
