# Turnobot backend (Go)

API REST + OAuth por empleado + sincronización con Google Calendar. Persistencia en Firestore. Producción en Cloud Run.

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
- `GET /api/v1/b/{slug}/slots?emp_id=&servicio_id=&fecha=YYYY-MM-DD` — horarios disponibles

### Reservas
- `POST /api/v1/b/{slug}/book` — crea reserva (Firestore + Calendar)
- `GET /api/v1/b/{slug}/citas?telefono=` — citas activas del cliente
- `DELETE /api/v1/b/{slug}/citas/{id}` — cancela (ventana 2h; el dueño siempre puede)

### Gestión (solo dueño)
- `DELETE /api/v1/b/{slug}/servicios/{id}` — eliminar servicio (en cascada)
- `DELETE /api/v1/b/{slug}/empleados/{id}` — eliminar empleado (en cascada)
- `POST /api/v1/b/{slug}/no-show/{id}` — marcar cita como no-show (sin notificaciones)

### OAuth
- `GET /auth/google/login` — iniciar OAuth con Google
- `GET /auth/google/callback` — callback de OAuth

## Archivos Go

| Archivo | Descripción |
|---------|-------------|
| `main.go` | Servidor HTTP, rutas, modelos de datos, handlers principales |
| `noshow.go` | Handler: `markNoShowHandler` (no-show + ajuste CRM) |
| `seed.go` | Datos de prueba para desarrollo |

## Despliegue

Desde la raíz del repo: `ENV_FILE=... ./deploy.sh only-backend`
