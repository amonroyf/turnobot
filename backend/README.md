# Turnobot backend (Go)

API REST + OAuth por empleado + sincronización con Google Calendar + Notificaciones Push. Persistencia en Firestore. Producción en Cloud Run.

## Variables de entorno

Copiar `.env.example` como referencia (no versionar valores reales):

- `GCP_PROJECT_ID`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `REDIRECT_URL`
- `FRONTEND_URL` (opcional; default `http://localhost:5173`)

## Desarrollo

```bash
cd backend
go run .                 # API en :8080
go test ./...            # tests unitarios
go vet ./...             # análisis estático
go run seed.go           # datos de prueba en Firestore (negocio barberia-vip)
```

## Endpoints

### Negocio y catálogo
- `GET /health` — health check
- `GET /api/v1/b/{slug}` — negocio, servicios y empleados
- `GET /api/v1/b/{slug}/slots?emp_id=&servicio_id=&fecha=YYYY-MM-DD` — horarios disponibles

### Reservas
- `POST /api/v1/b/{slug}/book` — crea reserva (Firestore + Calendar + push al dueño)
- `GET /api/v1/b/{slug}/citas?telefono=` — citas activas del cliente
- `DELETE /api/v1/b/{slug}/citas/{id}` — cancela (ventana 2h; el dueño siempre puede)

### Gestión (solo dueño)
- `DELETE /api/v1/b/{slug}/servicios/{id}` — eliminar servicio (en cascada)
- `DELETE /api/v1/b/{slug}/empleados/{id}` — eliminar empleado (en cascada)

### Notificaciones Push
- `GET /api/v1/b/{slug}/check-reminders` — verificar y enviar recordatorios (usado por Cloud Scheduler)
- `POST /api/v1/b/{slug}/no-show/{id}` — marcar cita como no-show
- `POST /api/v1/b/{slug}/register-push-token` — registrar token FCM del dueño

### OAuth
- `GET /auth/google/login` — iniciar OAuth con Google
- `GET /auth/google/callback` — callback de OAuth

## Archivos Go

| Archivo | Descripción |
|---------|-------------|
| `main.go` | Servidor HTTP, rutas, modelos de datos, handlers principales |
| `push.go` | Funciones de envío push (`sendPush`, `sendPushToNegocio`) |
| `pushHandler.go` | Handlers: `checkRemindersHandler`, `markNoShowHandler`, `registerPushTokenHandler` |
| `seed.go` | Datos de prueba para desarrollo |

## Despliegue

Desde la raíz del repo: `ENV_FILE=... ./deploy.sh only-backend`
