# Turnobot backend (Go)

API REST + OAuth por empleado + sincronización con Google Calendar. Persistencia en Firestore. Producción en Cloud Run.

## Variables de entorno

Copiar `.env.example` como referencia (no versionar valores reales):

- `GCP_PROJECT_ID`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `REDIRECT_URL`
- `CRON_SECRET` (auth del cron `check-reminders`)
- `EMPLOYEE_TOKEN_KEY` (firma sesiones de empleado, mín 32 chars; requerida)
- `FRONTEND_URL` (opcional; default `http://localhost:5173`)

## Desarrollo

```bash
cd backend
go run .                 # API en :8080
go test ./...            # tests unitarios (sin emulador se omiten los de handlers)
go vet ./...             # análisis estático
SEED_ALLOW_PROD=1 go run seed.go  # SOLO dev: sobrescribe negocios/barberia-vip
```

## Tests de handlers (emulador Firestore)

```bash
firebase emulators:start --only firestore   # puerto 8090 (ver firebase.emu.json de ejemplo en CI)
FIRESTORE_EMULATOR_HOST=127.0.0.1:8090 go test ./... -count=1
```

Cubren: reserva OK + CRM, servicio inválido 400, doble reserva concurrente
(8 goroutines → 1 ganador), cancel idempotente + liberación del slot, no-show
sin auth → 401.

## Endpoints

### Negocio y catálogo
- `GET /health` — health check
- `GET /api/v1/b/{slug}` — negocio, servicios y empleados
- `GET /api/v1/b/{slug}/slots?emp_id=&servicio_id=&fecha=YYYY-MM-DD` — horarios disponibles (`emp_id=any` une a todos los que ofrecen el servicio: `{slots, asignado_por_hora, profesionales}`)
- `GET /api/v1/b/{slug}/slots/primer-hueco?servicio_id=&emp_id=(id|any)&desde=&dias=14` — primer horario libre hacia adelante

### Reservas
- `POST /api/v1/b/{slug}/book` — crea reserva (Firestore + Calendar)
- `GET /api/v1/b/{slug}/citas?telefono=` — citas activas del cliente
- `DELETE /api/v1/b/{slug}/citas/{id}` — cancela (el cliente solo con 2h+ de antelación; el dueño y el equipo siempre pueden)
- `POST /api/v1/b/{slug}/citas/{id}/reschedule` — mueve la cita de día/hora (misma cita: no toca CRM; mueve el evento de Calendar; resetea `reminder_sent`)

### Gestión (solo dueño)
- `DELETE /api/v1/b/{slug}/servicios/{id}` — eliminar servicio (en cascada)
- `DELETE /api/v1/b/{slug}/empleados/{id}` — eliminar empleado (en cascada)
- `POST /api/v1/b/{slug}/empleados/{id}/pin` — asignar PIN al empleado
- `POST /api/v1/b/{slug}/no-show/{id}` — marcar cita como no-show (solo pasadas, + push al cliente)
- `POST /api/v1/b/{slug}/citas/{id}/undo` — deshacer cancelación/no-show del mismo día (recrea el evento de Calendar si se había borrado)
- `POST /api/v1/b/{slug}/citas/{id}/client-push-token` — registrar token del cliente
- `POST /api/v1/b/{slug}/register-push-token` — registrar push del dueño
- `DELETE /api/v1/b/{slug}/push-token` — baja de push del dueño
- `POST /api/v1/b/{slug}/push-test` — push de prueba a los dispositivos del dueño
- `POST /api/v1/b/{slug}/cache/invalidate` — limpiar caché en RAM

### Empleados (login con PIN, token 12h)
- `POST /api/v1/b/{slug}/employee-login` — login (lockout: 5 fallos = 15 min)
- `GET /api/v1/b/{slug}/employee/{id}/citas` — citas asignadas
- `POST /api/v1/b/{slug}/employee/{id}/register-push-token` — registrar push
- `DELETE /api/v1/b/{slug}/employee/{id}/push-token` — baja de push

### Cron y diagnóstico
- `POST /api/v1/check-reminders` — recordatorios cada 15 min (header `X-Cron-Secret`)
- `POST /api/v1/push-ping` — telemetría de recepción push

### OAuth
- `GET /auth/google/login` — iniciar OAuth con Google
- `GET /auth/google/callback` — callback de OAuth

## Archivos Go

| Archivo | Descripción |
|---------|-------------|
| `main.go` | Servidor HTTP, rutas, modelos de datos, handlers principales |
| `push.go` | Push FCM (dueño, empleado, cliente, test) y registro de tokens |
| `reminders.go` | Cron `check-reminders`: recordatorios + resumen al dueño |
| `undo.go` | Handler: `undoCitaHandler` (deshacer cancelación/no-show, restaura Calendar) |
| `reschedule.go` | Handler: `rescheduleCitaHandler` (mover cita sin tocar CRM) |
| `noshow.go` | Handler: `markNoShowHandler` (no-show + ajuste CRM) |
| `middleware.go` | CORS, security headers, rate limiting, logging |
| `cache.go` | Caché en RAM del negocio (TTL 5min) |
| `seed.go` | Datos de prueba para desarrollo (nunca contra prod sin `SEED_ALLOW_PROD=1`) |

## Despliegue

Desde la raíz del repo: `ENV_FILE=... ./deploy.sh only-backend`
