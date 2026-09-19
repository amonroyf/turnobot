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
- `GET /api/v1/b/{slug}/slots?emp_id=&servicio_id=&fecha=YYYY-MM-DD` — horarios del profesional (`emp_id=any` une a todos: `{slots, asignado_por_hora, profesionales}`)
- `GET /api/v1/b/{slug}/slots?recurso_id=&servicio_id=&fecha=` — horarios del espacio (ocupación exclusiva, jornada del negocio)
- `GET /api/v1/b/{slug}/slots/primer-hueco?servicio_id=&emp_id=(id|any)&recurso_id=&desde=&dias=14` — primer horario libre hacia adelante

### Reservas
- `POST /api/v1/b/{slug}/book` — crea reserva (Firestore + Calendar)
- `GET /api/v1/b/{slug}/citas?telefono=` — citas activas del cliente
- `DELETE /api/v1/b/{slug}/citas/{id}` — cancela (nunca citas pasadas; el cliente solo con la antelación de `cancel_window_hours`, default 24h; dueño y equipo siempre)
- `POST /api/v1/b/{slug}/citas/{id}/reschedule` — mueve la cita de día/hora (misma cita: no toca CRM; mueve el evento de Calendar; resetea `reminder_sent`)

### Gestión (solo dueño)
- `DELETE /api/v1/b/{slug}/servicios/{id}` — eliminar servicio (en cascada)
- `DELETE /api/v1/b/{slug}/empleados/{id}` — eliminar empleado (en cascada)
- `DELETE /api/v1/b/{slug}/recursos/{id}` — borrar espacio (409 si tiene citas futuras)
- `POST /api/v1/b/{slug}/empleados/{id}/pin` — asignar PIN al empleado
- `POST /api/v1/b/{slug}/no-show/{id}` — marcar cita como no-show (solo pasadas, + push al cliente)
- `POST /api/v1/b/{slug}/citas/{id}/undo` — deshacer cancelación/no-show (cita de hoy o acción <24h; recrea el evento de Calendar si se había borrado)
- `POST /api/v1/b/{slug}/citas/{id}/client-push-token` — registrar token del cliente
- `POST /api/v1/b/{slug}/register-push-token` — registrar push del dueño
- `GET /api/v1/b/{slug}/existe` — público: dice si el enlace existe (registro; sin datos sensibles)
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

## Reglas de negocio (comparadas con el mercado: Fresha, Booksy, Vagaro, Mindbody)

| Regla | TurnoBot | Mercado | Nota |
|-------|----------|---------|------|
| Antelación para cancelar/mover (cliente) | `cancel_window_hours`, default **24h**, tope 1-72h; dueño/equipo libres | 24h belleza, 48h spa/salud, configurable (Vagaro cutoff, Booksy días/horas, Mindbody ventana) | El dueño lo cambia en Admin → Tus reglas |
| Citas pasadas | Nadie las cancela ni las mueve (usar No llegó) | Igual: el historial no se reescribe | Protege CRM |
| No-show | Solo dueño/equipo, solo pasadas; contador `no_shows` por cliente visible en CRM/CSV | Reporte Cancellation & No-Show + tarjeta en archivo (Vagaro/Booksy); sin pagos no hay cobro automático | Contador listo para bloquear reincidentes a futuro |
| Deshacer | Cita de hoy o acción <24h (corrige no-show marcado tarde) | Sin estándar; corrección operativa | Guarda `cancelled_at`/`no_show_at` |
| Recordatorio push | `reminder_hours_before`, default **24h**, techo 72h | Secuencia 48h+24h+2h multicanal (SMS 98% apertura) | Un solo push (sin SMS/WhatsApp API aún) |
| Tope por teléfono/día | Default 3, tope 20 | Sin estándar (anti-spam propio) | Mensaje usa el valor configurado |
| Antelación mínima | `min_notice_minutes`, default 0 | Configurable (Mindbody) | — |
| Ventana de reserva | `booking_window_days`, default 30, tope 365 | Schedule window configurable (Mindbody) | — |
| Rate limit escritura | 10/min por IP+negocio, solo `book`/`reschedule` | Anti-bot en booking | Staff (undo/no-show/PIN) sin límite estricto |
| Teléfono | Formato E.164 válido (libphonenumber) + throttle 5 intentos/hora por número+negocio + tope 3/día | OTP por SMS/WhatsApp como prueba de titularidad | Sin OTP cualquiera reserva con número ajeno; el acoso (ver/cancelar citas de otro con su número) se mitiga con IDs no adivinables + consulta mínima de 7 dígitos |
| Login empleado | PIN 4-6 + lockout 5 fallos/15min + token 12h | PIN por empleado (estándar simple) | Lockout en memoria (multi-instancia lo diluye) |

Sin pagos en línea aún: el mercado cobra seña/cuota de no-show con tarjeta en
archivo (Booksy prepayments, Vagaro capture-card, Pabau deposits). TurnoBot hoy
solo previene (ventana 24h + contador + recordatorio 24h).

## Despliegue

Desde la raíz del repo: `ENV_FILE=... ./deploy.sh only-backend`
