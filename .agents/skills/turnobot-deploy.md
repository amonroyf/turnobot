# Turnobot: Flujo Completo de Desarrollo a Producción

Skill reutilizable para aplicar cambios, verificar, testear y desplegar Turnobot.

## Contexto del Proyecto

- **Frontend:** React + Vite + Tailwind (en `frontend/`)
- **Backend:** Go + Firestore + Google Calendar (en `backend/`)
- **Proyecto GCP:** `stalwart-coast-439901-d0`
- **Producción:** Cloud Run (backend) + Firebase Hosting (frontend)

## Flujo Paso a Paso

### Fase 1: Aplicar Cambios de Código

1. Leer los archivos afectados con `read_files`
2. Aplicar cambios con `str_replace` o `write_file`
3. Verificar que los imports existen en el proyecto antes de usar librerías nuevas

### Fase 2: Verificar Builds

```bash
# Backend Go
cd backend && go build ./... && go test ./...

# Frontend Vite
cd frontend && npx vite build
```

Ambos deben compilar sin errores antes de continuar.

### Fase 3: Configurar Permisos GCP (si hace falta)

Si los e2e tests fallan con `PERMISSION_DENIED`:

```bash
# Asignar rol Firestore al usuario
gcloud projects add-iam-policy-binding stalwart-coast-439901-d0 \
  --member="user:$(gcloud config get-value account)" \
  --role="roles/datastore.user"

# Si el ADC está stale, re-autenticar:
gcloud auth application-default login --no-launch-browser --project=stalwart-coast-439901-d0
```

### Fase 4: Correr E2E Tests

Los tests necesitan backend (Go :8080) y frontend (Vite :5173) corriendo.

```bash
# 1. Levantar servidores (en background, desacoplados con setsid)
cd backend && setsid go run main.go &>/tmp/backend.log & disown
sleep 3
cd frontend && setsid npx vite --host &>/tmp/vite.log & disown
sleep 4

# 2. Verificar que responden
curl -s http://localhost:8080/health  # Debe decir "Turnobot API REST OK"
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173  # Debe ser 200

# 3. Correr tests ( booking.spec.js es el más relevante para cambios de calendario/reservas )
cd frontend && npx playwright test e2e-tests/booking.spec.js --reporter=line

# 4. O correr todos (tarda ~2-3 min)
cd frontend && npx playwright test --reporter=line

# 5. Limpiar servidores después
pkill -f "go run main.go" 2>/dev/null; pkill -f "vite" 2>/dev/null
```

**Nota:** Usar `setsid` es obligatorio. Sin él, Playwright mata los servidores cuando ejecuta `globalSetup`.

### Fase 5: Deploy a Producción

```bash
# Deploy completo (backend + frontend)
ENV_FILE=/tmp/opencode/env_full.yaml ./deploy.sh both

# Solo frontend
ENV_FILE=/tmp/opencode/env_full.yaml ./deploy.sh only-frontend

# Solo backend
ENV_FILE=/tmp/opencode/env_full.yaml ./deploy.sh only-backend
```

**URLs de producción:**
- Backend: `https://turnobot-850305350371.us-central1.run.app`
- Frontend: `https://turnobot-web.web.app`
- API Health: `https://turnobot-850305350371.us-central1.run.app/health`

## Archivos Clave

| Archivo | Propósito |
|---|---|
| `backend/main.go` | API REST completa (slots, booking, cancelación, CRM, Calendar) |
| `frontend/src/BookingApp.jsx` | UI pública de reservas (calendario, pasos, WhatsApp) |
| `frontend/src/AdminDashboard.jsx` | Panel de administración (servicios, profesionales, reservas, CRM) |
| `frontend/src/MisCitas.jsx` | Consulta y cancelación de citas por teléfono |
| `deploy.sh` | Script de despliegue a Cloud Run + Firebase Hosting |
| `scripts/deploy-hosting.mjs` | Deploy custom a Firebase Hosting (sin firebase-tools CLI) |
| `scripts/deploy-rules.mjs` | Deploy de reglas de Firestore |
| `frontend/e2e-tests/setup.js` | Helper de tests (garantizarTiendaE2E, limpiarReservas, etc.) |

## Reglas de Negocio Importantes

1. **Citas pasadas son sagradas:** Nadie puede cancelarlas (protege CRM/LTV)
2. **Ventana de reservas:** Máximo 30 días en el futuro (backend + frontend)
3. **Cancelación de clientes:** Bloqueada con menos de 2 horas de anticipación
4. **Una cita por día por cliente:** Límite estricto en `bookHandler`
5. **Sin anticipación mínima:** Se puede reservar cualquier slot libre inmediato

## Comandos Rápidos de Referencia

```bash
# Verificar que la API responde en producción
curl -s https://turnobot-850305350371.us-central1.run.app/health

# Ver slots disponibles (mock, sin calendar)
curl -s "https://turnobot-850305350371.us-central1.run.app/api/v1/b/tienda-e2e/slots?emp_id=emp_alejandro&servicio_id=svc_corte_barba&fecha=2026-09-15"

# Logs de Cloud Run
gcloud run services logs read turnobot --region=us-central1 --limit=20

# Verificar estado del deploy
gcloud run services describe turnobot --region=us-central1 --format="value(status.url)"
```
