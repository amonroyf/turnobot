# Turnobot — Agendamiento web para salones / barberías

Aplicación web para reservas de citas, con sincronización automática a Google Calendar por empleado.

## Estructura

- `backend/` — API REST en Go (Cloud Run). Ver `backend/README.md`.
- `frontend/` — app web en React + Vite + Tailwind (Firebase Hosting). Ver `frontend/README.md`.
- `firestore.rules` — reglas de seguridad de Firestore.
- `firestore.indexes.json` — índices compuestos de Firestore.
- `scripts/` — despliegues, reglas, scheduler.
- `deploy.sh` — despliegue completo (backend + frontend).

## URLs de Producción

| Servicio | URL |
|----------|-----|
| Backend API | https://turnobot-850305350371.us-central1.run.app |
| Frontend | https://turnobot-web.web.app |
| Firebase Project | stalwart-coast-439901-d0 |

## Despliegue

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
| `/api/v1/b/{slug}` | GET | Datos del negocio, servicios y empleados |
| `/api/v1/b/{slug}/slots` | GET | Horarios disponibles para un empleado/fecha |
| `/api/v1/b/{slug}/book` | POST | Crear reserva (Firestore + Google Calendar) |
| `/api/v1/b/{slug}/citas` | GET | Citas activas del cliente por teléfono |
| `/api/v1/b/{slug}/citas/{id}` | DELETE | Cancelar cita |
| `/api/v1/b/{slug}/servicios/{id}` | DELETE | Eliminar servicio (en cascada) |
| `/api/v1/b/{slug}/empleados/{id}` | DELETE | Eliminar empleado (en cascada) |
| `/api/v1/b/{slug}/check-reminders` | GET | Verificar y enviar recordatorios push |
| `/api/v1/b/{slug}/no-show/{id}` | POST | Marcar cita como no-show |
| `/api/v1/b/{slug}/register-push-token` | POST | Registrar token FCM del dueño |

## Notificaciones Push (Web Push FCM)

### Componentes

| Archivo | Descripción |
|---------|-------------|
| `backend/push.go` | Funciones de envío push usando Firebase Admin SDK |
| `backend/pushHandler.go` | Handlers HTTP: check-reminders, markNoShow, registerPushToken |
| `frontend/src/pushNotifications.js` | Registro de permiso push y escucha de mensajes |

### Flujo

1. **Dueño inicia sesión** → Se solicita permiso push → Token se guarda en Firestore (`negocios.push_token`)
2. **Nueva reserva** → Se envía push "Nueva cita agendada"
3. **30 min antes de la cita** → Cloud Scheduler ejecuta check-reminders → Se envía recordatorio
4. **Dueño marca "No Llegó"** → Reserva se marca como `no_show: true`

### Requisitos

- El dueño debe abrir el panel admin al menos una vez para registrar su token push
- La service account de Firebase debe tener permisos FCM

## Cloud Scheduler

Job programado para ejecutar recordatorios cada 5 minutos:

```bash
gcloud scheduler jobs create http turnobot-reminders \
  --schedule="*/5 * * * *" \
  --uri="https://turnobot-850305350371.us-central1.run.app/api/v1/b/turnobot/check-reminders" \
  --http-method=GET \
  --location=us-central1 \
  --oidc-service-account-email=850305350371-compute@developer.gserviceaccount.com
```

| Job | Schedule | Endpoint |
|-----|----------|----------|
| turnobot-reminders | `*/5 * * * *` | GET /api/v1/b/{slug}/check-reminders |

## Firestore Indexes

Índices compuestos desplegados:

| Colección | Campos | Uso |
|-----------|--------|-----|
| reservas | negocio_id + emp_id + date_time | Cálculo de slots disponibles |
| reservas | user_phone + negocio_id + date_time | Listado de citas del cliente + anti-spam |
| reservas | negocio_id + date_time | Check-reminders (recordatorios push) |

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
| `PORT` | Puerto del servidor (default: 8080) |

## Multi-tenant

- Un tenant = un negocio identificado por slug
- El mismo backend atiende múltiples tenants; la discriminación es por slug en la URL
- Cada negocio tiene su propio calendario, empleados, servicios y clientes
