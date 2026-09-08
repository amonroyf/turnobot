# Turnobot backend (Go)

API REST + OAuth por empleado + sincronización con Google Calendar. Persistencia en Firestore. Producción en Cloud Run (ver `Dockerfile`, usa imagen con `tzdata`).

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

- `GET /health`
- `GET /api/v1/b/{slug}` — negocio, servicios y empleados
- `GET /api/v1/b/{slug}/slots?emp_id=&servicio_id=&fecha=YYYY-MM-DD`
- `POST /api/v1/b/{slug}/book` — crea reserva (Firestore + Calendar)
- `GET /api/v1/b/{slug}/citas?telefono=` — citas activas del cliente
- `DELETE /api/v1/b/{slug}/citas/{id}` — cancela (ventana 2h; el dueño siempre puede)
- `DELETE /api/v1/b/{slug}/servicios/{id}` — solo dueño, en cascada
- `DELETE /api/v1/b/{slug}/empleados/{id}` — solo dueño, en cascada
- `GET /auth/google/login` / `GET /auth/google/callback` — OAuth por empleado

## Despliegue

Desde la raíz del repo: `ENV_FILE=... ./deploy.sh only-backend`.
