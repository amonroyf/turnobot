# Guía de Despliegue — Turnobot

Documentación completa de todos los procesos de despliegue, infraestructura y configuración en producción.

---

## Tabla de Contenidos

1. [Arquitectura de Producción](#1-arquitectura-de-producción)
2. [Prerrequisitos](#2-prerrequisitos)
3. [Variables de Entorno](#3-variables-de-entorno)
4. [Despliegue Manual](#4-despliegue-manual)
5. [CI/CD Automático](#5-cicd-automático)
6. [Cloud Run (Backend)](#6-cloud-run-backend)
7. [Firebase Hosting (Frontend)](#7-firebase-hosting-frontend)
8. [Firestore (Base de Datos)](#8-firestore-base-de-datos)
9. [Cloud Scheduler (Backups)](#9-cloud-scheduler-backups)
10. [Backups Automáticos](#10-backups-automáticos)
11. [Monitoreo y Health Checks](#11-monitoreo-y-health-checks)
12. [Seguridad](#12-seguridad)
13. [Troubleshooting](#13-troubleshooting)
14. [Comandos de Referencia Rápida](#14-comandos-de-referencia-rápida)

---

## 1. Arquitectura de Producción

```
┌─────────────────────────────────────────────────────────────┐
│                     GOOGLE CLOUD PROJECT                     │
│                   stalwart-coast-439901-d0                    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────┐     ┌─────────────────────────────┐    │
│  │  Firebase Host   │     │       Cloud Run             │    │
│  │  (Frontend)      │────▶│  turnobot (Backend Go)      │    │
│  │  React + Vite    │     │  us-central1                │    │
│  └─────────────────┘     │  0-20 instancias            │    │
│         │                 └──────────┬──────────────────┘    │
│         │                            │                        │
│         ▼                            ▼                        │
│  ┌─────────────┐          ┌──────────────────┐              │
│  │  Firebase    │          │    Firestore      │              │
│  │  Auth        │          │  (Base de datos)  │              │
│  └─────────────┘          └──────────────────┘              │
│                                                               │
 │  ┌──────────────────────────────────────────────────────┐   │
 │  │              Cloud Scheduler                          │   │
 │  │  • firestore-backup-daily     (diario 2AM)           │   │
 │  └──────────────────────────────────────────────────────┘   │
 │                                                               │
 │  ┌──────────────────────────────────────────────────┐       │
 │  │  Google Calendar API                              │       │
 │  │  (Calendarios de empleados)                       │       │
 │  └──────────────────────────────────────────────────┘       │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### URLs de Producción

| Servicio | URL | Descripción |
|----------|-----|-------------|
| **Frontend** | `https://turnobot-web.web.app` | App web para clientes y admin |
| **Backend API** | `https://turnobot-ehomyvoh6q-uc.a.run.app` | API REST (Go) |
| **Firebase Console** | `https://console.firebase.google.com/project/stalwart-coast-439901-d0` | Gestión |
| **GCP Console** | `https://console.cloud.google.com/project/stalwart-coast-439901-d0` | Infraestructura |

---

## 2. Prerrequisitos

### Herramientas necesarias

```bash
# Google Cloud SDK
gcloud --version
gcloud auth login
gcloud config set project stalwart-coast-439901-d0

# Firebase CLI
firebase --version
firebase login

# Node.js (para frontend)
node --version  # >= 18
npm --version

# Go (para backend)
go version  # >= 1.22
```

### Permisos requeridos en GCP

| Rol | Servicio | Para qué |
|-----|----------|----------|
| `roles/run.admin` | Cloud Run | Desplegar backend |
| `roles/firebasehosting.admin` | Firebase Hosting | Desplegar frontend |
| `roles/datastore.user` | Firestore | Leer/escribir datos |
| `roles/cloudscheduler.admin` | Cloud Scheduler | Gestionar jobs |
| `roles/iam.serviceAccountUser` | IAM | Usar service accounts |

### Service Account utilizada

```
850305350371-compute@developer.gserviceaccount.com
```

---

## 3. Variables de Entorno

### Backend (Cloud Run)

El archivo de entorno **no se versiona** (contiene secretos). Se encuentra en:

```
/tmp/opencode/env_full.yaml
```

Formato YAML para `--env-vars-file`:

```yaml
GCP_PROJECT_ID: stalwart-coast-439901-d0
GOOGLE_CLIENT_ID: <tu-client-id>
GOOGLE_CLIENT_SECRET: <tu-client-secret>
REDIRECT_URL: https://turnobot-ehomyvoh6q-uc.a.run.app/auth/google/callback
PORT: "8080"
FRONTEND_URL: https://turnobot-web.web.app
```

### Frontend (Firebase Hosting)

| Variable | Valor | Dónde se usa |
|----------|-------|--------------|
| `VITE_API_URL` | `https://turnobot-ehomyvoh6q-uc.a.run.app` | URL del backend API |

Se configuran en `frontend/.env.production` o como variables de build:

```bash
VITE_API_URL="https://turnobot-ehomyvoh6q-uc.a.run.app" \
npm run build
```

### GitHub Actions Secrets

Para CI/CD automático, configurar en GitHub → Settings → Secrets:

| Secret | Valor |
|--------|-------|
| `VITE_API_URL` | `https://turnobot-ehomyvoh6q-uc.a.run.app` |
| `WIF_PROVIDER` | Workload Identity Federation provider |
| `WIF_SERVICE_ACCOUNT` | Service account para CI/CD |

---

## 4. Despliegue Manual

### Despliegue completo (backend + frontend)

```bash
ENV_FILE=/tmp/opencode/env_full.yaml ./deploy.sh
```

### Despliegue parcial

```bash
# Solo backend (Cloud Run)
ENV_FILE=/tmp/opencode/env_full.yaml ./deploy.sh only-backend

# Solo frontend (Firebase Hosting)
ENV_FILE=/tmp/opencode/env_full.yaml ./deploy.sh only-frontend
```

### Despliegue de Firestore (reglas e índices)

```bash
# Reglas de seguridad
TOKEN=$(gcloud auth print-access-token) node scripts/deploy-rules.mjs

# Índices compuestos
TOKEN=$(gcloud auth print-access-token) \
  firebase --project stalwart-coast-439901-d0 deploy --only firestore:indexes
```

### Qué hace cada comando

| Comando | Qué despliega | Tiempo aprox. |
|---------|---------------|---------------|
| `./deploy.sh` | Backend + Frontend | ~3-5 min |
| `./deploy.sh only-backend` | Solo Cloud Run | ~2-3 min |
| `./deploy.sh only-frontend` | Solo Firebase Hosting | ~1-2 min |
| `deploy-rules.mjs` | Firestore rules | ~30 seg |
| `firebase deploy --only firestore:indexes` | Índices Firestore | ~30 seg |

---

## 5. CI/CD Automático

### Pipeline (`.github/workflows/ci.yml`)

```
Push a main → Backend Test → Frontend Build → Deploy automático
Pull Request → Backend Test → Frontend Build (sin deploy)
```

### Jobs del pipeline

#### 1. `backend-test`
```yaml
- Go build (verifica compilación)
- Go test (ejecuta unit tests)
```

#### 2. `frontend-build`
```yaml
- npm ci (instala dependencias)
- npm run build (compila React + Vite)
```

#### 3. `deploy` (solo en push a main)
```yaml
- Autenticación via Workload Identity Federation
- gcloud run deploy (backend)
- npm build + deploy-hosting.mjs (frontend)
```

### Configurar CI/CD por primera vez

1. **Habilitar Workload Identity Federation:**
```bash
gcloud iam workload-identity-pools create "github" \
  --location="global" \
  --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc "github" \
  --location="global" \
  --workload-identity-pool="github" \
  --display-name="GitHub" \
  --attribute-mapping="google.subject=assertion.sub,attribute.aud=assertion.aud" \
  --issuer-uri="https://token.actions.githubusercontent.com"
```

2. **Asignar permisos al service account:**
```bash
gcloud iam service-accounts add-iam-policy-binding \
  850305350371-compute@developer.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/stalwart-coast-439901-d0/locations/global/workloadIdentityPools/github/attribute.repository/TU_REPO"
```

3. **Configurar secrets en GitHub:**
   - Ir a GitHub → Tu repo → Settings → Secrets and variables → Actions
   - Agregar: `WIF_PROVIDER`, `WIF_SERVICE_ACCOUNT`, `VITE_API_URL`

---

## 6. Cloud Run (Backend)

### Configuración actual

| Parámetro | Valor |
|-----------|-------|
| Servicio | `turnobot` |
| Región | `us-central1` |
| CPU | 1 |
| Memoria | 512Mi |
| Concurrency | 80 |
| Timeout | 300s |
| Instancias mín | 0 (escala a cero) |
| Instancias máx | 20 |
| Service Account | `850305350371-compute@developer.gserviceaccount.com` |
| Auth | `--allow-unauthenticated` (API pública) |

### Despliegue manual del backend

```bash
gcloud run deploy turnobot \
  --source backend \
  --region us-central1 \
  --platform managed \
  --service-account 850305350371-compute@developer.gserviceaccount.com \
  --env-vars-file /tmp/opencode/env_full.yaml \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --concurrency 80 \
  --timeout 300 \
  --port 8080 \
  --min-instances 0 \
  --max-instances 20 \
  --quiet
```

### Verificar despliegue

```bash
# Ver la última revisión
gcloud run services describe turnobot --region us-central1 --format="value(status.latestReadyRevisionName)"

# Ver URL del servicio
gcloud run services describe turnobot --region us-central1 --format="value(status.url)"

# Ver logs en tiempo real
gcloud run services logs read turnobot --region us-central1 --limit 50

# Ver logs streaming
gcloud run services logs tail turnobot --region us-central1
```

### Endpoints del backend

| Endpoint | Método | Rate Limit | Descripción |
|----------|--------|------------|-------------|
| `/health` | GET | 60/min | Health check (verifica Firestore) |
| `/api/v1/b/{slug}` | GET | 60/min | Datos del negocio |
| `/api/v1/b/{slug}/slots` | GET | 60/min | Horarios disponibles |
| `/api/v1/b/{slug}/book` | POST | **10/min** | Crear reserva |
| `/api/v1/b/{slug}/citas` | GET | 60/min | Citas del cliente |
| `/api/v1/b/{slug}/citas/{id}` | DELETE | 60/min | Cancelar cita |
| `/api/v1/b/{slug}/no-show/{id}` | POST | 60/min | Marcar no-show |
| `/api/v1/b/{slug}/servicios/{id}` | DELETE | 60/min | Eliminar servicio |
| `/api/v1/b/{slug}/empleados/{id}` | DELETE | 60/min | Eliminar empleado |
| `/auth/google/login` | GET | 60/min | OAuth Google Calendar |
| `/auth/google/callback` | GET | 60/min | Callback OAuth |

### Middleware (cadena de seguridad)

Cada request pasa por esta cadena:
```
Security Headers → CORS → Rate Limiting → Logging → Handler
```

---

## 7. Firebase Hosting (Frontend)

### Configuración

| Parámetro | Valor |
|-----------|-------|
| Sitio | `turnobot-web` |
| URL | `https://turnobot-web.web.app` |
| Project | `stalwart-coast-439901-d0` |

### Despliegue manual del frontend

```bash
cd frontend

# 1. Build
VITE_API_URL="https://turnobot-ehomyvoh6q-uc.a.run.app" \
npm run build

# 2. Deploy
export TOKEN=$(gcloud auth print-access-token)
SITE=turnobot-web node scripts/deploy-hosting.mjs
```

### Estructura del build

```
frontend/dist/
├── index.html
├── assets/
│   ├── index-[hash].js         ← Bundle principal (~233 KB)
│   ├── AdminDashboard-[hash].js ← Lazy loaded (~27 KB)
│   ├── BookingApp-[hash].js     ← Lazy loaded (~21 KB)
│   ├── RegisterShop-[hash].js   ← Lazy loaded (~6 KB)
│   └── index-[hash].css         ← Estilos (~12 KB)
```

### Code splitting (lazy loading)

Los componentes principales se cargan bajo demanda:
- `BookingApp` → solo en `/shop/:slug`
- `AdminDashboard` → solo en `/admin`
- `RegisterShop` → solo en `/register`
- `MisCitas` → solo en `/mis-citas`

### Firebase.json

```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  }
}
```

---

## 8. Firestore (Base de Datos)

### Colecciones

```
stalwart-coast-439901-d0 (default)
├── negocios/{slug}
│   ├── name, owner_uid, timezone, open_time, close_time
│   ├── servicios/{svcId}
│   │   └── name, duration_minutes, price
│   └── empleados/{empId}
│       └── name, calendar_id, refresh_token, horario
├── reservas/{autoId}
│   └── negocio_id, owner_uid, emp_id, user_phone, client_name,
│       service_name, duration_minutes, price, date_time,
│       calendar_event_id, no_show, cancelled, cancelled_at,
│       created_at
└── clientes/{slug__phone}
    └── negocio_id, owner_uid, cliente_phone, client_name,
        visits, total_spent, last_seen, last_date_str, updated_at
```

### Índices compuestos

| Colección | Campos | Uso |
|-----------|--------|-----|
| `reservas` | `negocio_id + emp_id + date_time` | Cálculo de slots disponibles |
| `reservas` | `user_phone + negocio_id + date_time` | Listado de citas + anti-spam |

### Reglas de seguridad

```javascript
// Solo backend Go puede crear reservas
match /reservas/{doc} {
  allow create: if false;
  allow read: if resource.data.owner_uid == request.auth.uid;
}

// Lectura de clientes por owner_uid
match /clientes/{doc} {
  allow read: if resource.data.owner_uid == request.auth.uid;
}
```

### Desplegar reglas e índices

```bash
# Reglas
TOKEN=$(gcloud auth print-access-token) node scripts/deploy-rules.mjs

# Índices
TOKEN=$(gcloud auth print-access-token) \
  firebase --project stalwart-coast-439901-d0 deploy --only firestore:indexes
```

---

## 9. Cloud Scheduler (Backups)

### Jobs activos

| Job | Schedule | Timezone | Descripción |
|-----|----------|----------|-------------|
| `firestore-backup-daily` | `0 7 * * *` | America/Bogota | Backup diario a las 2AM Colombia |

### Crear/actualizar jobs

```bash
# Backup de Firestore
gcloud scheduler jobs create http firestore-backup-daily \
  --schedule="0 7 * * *" \
  --time-zone="America/Bogota" \
  --uri="https://console.cloud.google.com" \
  --http-method=GET \
  --oidc-service-account-email=850305350371-compute@developer.gserviceaccount.com \
  --description="Backup diario de Firestore a las 2AM Colombia"
```

### Verificar jobs

```bash
# Listar todos los jobs
gcloud scheduler jobs list
```

---

## 10. Backups Automáticos

### Configuración

| Parámetro | Valor |
|-----------|-------|
| Bucket | `gs://stalwart-coast-439901-d0-firestore-backups` |
| Schedule | Diario a las 2AM Colombia (`0 7 * * *` UTC) |
| Tipo | Exportación completa de Firestore |
| Retención | Default GCP (30 días) |

### Crear bucket de backups

```bash
gsutil mb -p stalwart-coast-439901-d0 -l us-central1 gs://stalwart-coast-439901-d0-firestore-backups
```

### Backup manual

```bash
./scripts/firestore-backup.sh
```

### Verificar backups

```bash
# Listar exports
gcloud firestore export list --project=stalwart-coast-439901-d0

# Listar archivos en bucket
gsutil ls gs://stalwart-coast-439901-d0-firestore-backups/
```

### Restaurar backup

```bash
gcloud firestore import gs://stalwart-coast-439901-d0-firestore-backups/2026-09-10T07:00:00_12345 \
  --project=stalwart-coast-439901-d0
```

---

## 11. Monitoreo y Health Checks

### Health check endpoint

```bash
curl https://turnobot-ehomyvoh6q-uc.a.run.app/health
```

Respuesta OK:
```json
{
  "status": "ok",
  "timestamp": "2026-09-10T12:00:00Z",
  "version": "1.0.0"
}
```

Respuesta degradada:
```json
{
  "status": "degraded",
  "timestamp": "2026-09-10T12:00:00Z",
  "version": "1.0.0"
}
```

### Ver logs

```bash
# Logs recientes
gcloud run services logs read turnobot --region us-central1 --limit 100

# Logs streaming (tiempo real)
gcloud run services logs tail turnobot --region us-central1

# Logs de errores
gcloud run services logs read turnobot --region us-central1 --limit 50 2>&1 | grep '"level":"error"'
```

### Formato de logs (structured JSON)

```json
{
  "timestamp": "2026-09-10T12:00:00Z",
  "level": "info",
  "method": "POST",
  "path": "/api/v1/b/tu-slug/book",
  "status": 201,
  "duration": "45ms",
  "ip": "200.100.50.25"
}
```

### Verificar servicios de GCP

```bash
# Estado de Cloud Run
gcloud run services describe turnobot --region us-central1

# Últimas revisiones
gcloud run revisions list --service turnobot --region us-central1 --limit 5

# Tráfico
gcloud run services describe turnobot --region us-central1 --format="value(status.traffic)"
```

---

## 12. Seguridad

### Middlewares activos

| Middleware | Función |
|------------|---------|
| **CORS** | Solo permite dominios: `turnobot-web.web.app`, `localhost:5173`, `localhost:3000` |
| **Rate Limiting General** | 60 requests/min por IP |
| **Rate Limiting Booking** | 10 bookings/min por IP |
| **Security Headers** | HSTS, X-Frame-Options, X-Content-Type-Options, CSP |
| **Structured Logging** | JSON con timestamp, level, method, path, status, duration, IP |

### Autenticación

| Endpoint | Requiere auth | Tipo |
|----------|---------------|------|
| `GET /api/v1/b/{slug}` | No | Público |
| `GET /api/v1/b/{slug}/slots` | No | Público |
| `POST /api/v1/b/{slug}/book` | No | Público (rate limited) |
| `DELETE /api/v1/b/{slug}/citas/{id}` | No* | *Verificado por owner_uid |
| `DELETE /api/v1/b/{slug}/servicios/{id}` | **Sí** | Firebase ID token (owner) |
| `DELETE /api/v1/b/{slug}/empleados/{id}` | **Sí** | Firebase ID token (owner) |
| `POST /api/v1/b/{slug}/no-show/{id}` | **Sí** | Firebase ID token (owner) |

### CORS — Dominios permitidos

```go
var allowedOrigins = map[string]bool{
    "https://turnobot-web.web.app":                true,
    "https://stalwart-coast-439901-d0.web.app":   true,
    "http://localhost:5173":                       true,
    "http://localhost:3000":                       true,
}
```

### Rate Limiting

```
General:     60 requests/min por IP
Booking:     10 requests/min por IP (POST a /book)
Cleanup:     Cada 5 minutos se limpian IPs inactivas
```

### Security Headers

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Strict-Transport-Security: max-age=63072000; includeSubDomains (solo HTTPS)
```

---

## 13. Troubleshooting

### El frontend no carga

```bash
# Verificar que el build existe
ls -la frontend/dist/index.html

# Rebuild
cd frontend && npm run build

# Redesplegar
export TOKEN=$(gcloud auth print-access-token)
SITE=turnobot-web node scripts/deploy-hosting.mjs
```

### El backend no responde

```bash
# Verificar estado
gcloud run services describe turnobot --region us-central1

# Ver logs de error
gcloud run services logs read turnobot --region us-central1 --limit 20 2>&1 | grep -i error

# Verificar health
curl https://turnobot-ehomyvoh6q-uc.a.run.app/health
```

### Rate limiting bloquea requests

```bash
# Si estás haciendo muchas pruebas, el rate limiter puede bloquearte
# Solución: esperar 1 minuto o reiniciar el servicio
gcloud run services describe turnobot --region us-central1
```

### Errores de Firestore

```bash
# Verificar índices desplegados
firebase --project stalwart-coast-439901-d0 firestore:indexes:list

# Si hay errores de índice faltante, Firebase Console mostrará un link para crearlo
```

### Cloud Scheduler (backups) no ejecuta

```bash
# Verificar estado del job
gcloud scheduler jobs describe firestore-backup-daily

# Ver logs de ejecución
gcloud logging read "resource.type=cloud_scheduler_job" --limit 10
```

---

## 14. Comandos de Referencia Rápida

### Despliegue

```bash
# Todo
ENV_FILE=/tmp/opencode/env_full.yaml ./deploy.sh

# Solo backend
ENV_FILE=/tmp/opencode/env_full.yaml ./deploy.sh only-backend

# Solo frontend
ENV_FILE=/tmp/opencode/env_full.yaml ./deploy.sh only-frontend

# Firestore rules + indexes
TOKEN=$(gcloud auth print-access-token) node scripts/deploy-rules.mjs
TOKEN=$(gcloud auth print-access-token) firebase --project stalwart-coast-439901-d0 deploy --only firestore:indexes
```

### Monitoreo

```bash
# Health check
curl https://turnobot-ehomyvoh6q-uc.a.run.app/health

# Logs
gcloud run services logs tail turnobot --region us-central1

# Estado del servicio
gcloud run services describe turnobot --region us-central1

# Revisiones
gcloud run revisions list --service turnobot --region us-central1 --limit 5
```

### Firestore

```bash
# Backup manual
./scripts/firestore-backup.sh

# Verificar backups
gcloud firestore export list --project=stalwart-coast-439901-d0

# Desplegar reglas
TOKEN=$(gcloud auth print-access-token) node scripts/deploy-rules.mjs
```

### Cloud Scheduler

```bash
# Listar jobs
gcloud scheduler jobs list
```

### Tests

```bash
# Go tests
cd backend && go test ./... -v -count=1

# Go build
cd backend && go build ./...

# Frontend build
cd frontend && npm run build

# E2E tests (requiere backend + frontend corriendo)
cd frontend && npx playwright test horarios.spec.js
```

### Debug

```bash
# Logs de errores
gcloud run services logs read turnobot --region us-central1 --limit 50 2>&1 | grep '"level":"error"'

# Verificar variables de entorno
gcloud run services describe turnobot --region us-central1 --format="value(spec.template.spec.containers[0].env)"

# Verificar CORS
curl -I -X OPTIONS https://turnobot-ehomyvoh6q-uc.a.run.app/api/v1/b/test \
  -H "Origin: https://turnobot-web.web.app" \
  -H "Access-Control-Request-Method: GET"
```

---

## Archivos de Infraestructura

| Archivo | Descripción |
|---------|-------------|
| `deploy.sh` | Script principal de despliegue |
| `scripts/deploy-hosting.mjs` | Deploy de Firebase Hosting |
| `scripts/deploy-rules.mjs` | Deploy de Firestore rules |
| `scripts/firestore-backup.sh` | Backup automático de Firestore |
| `firestore.rules` | Reglas de seguridad de Firestore |
| `firestore.indexes.json` | Índices compuestos de Firestore |
| `.github/workflows/ci.yml` | Pipeline CI/CD |
| `firebase.json` | Configuración de Firebase |
