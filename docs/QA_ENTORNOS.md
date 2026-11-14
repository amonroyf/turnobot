# Entornos de QA: local/emulador vs GCP de práctica

> Turnobot tiene dos formas de correr E2E. Elegí una por corrida; no mezcles
> variables del emulador con el proyecto real.

## 1. Resumen

| Entorno | `E2E_TARGET` | Firestore/Auth | Web/API | Specs que corren |
|---|---|---|---|---|
| Local/CI | `local` (default) | Emulador con `--project demo-test` | Vite `:5173` + Go `:8080` | `booking-pom`, `horarios` |
| GCP práctica | `gcp` | Proyecto real `stalwart-coast-439901-d0` | Firebase Hosting + Cloud Run | Toda la suite |

El modo local es rápido y gratis, pero hoy el frontend apunta a Firebase real
mientras el Admin SDK apunta al emulador. Por eso los flujos que exigen login
se reservan para el modo GCP.

El modo GCP usa el proyecto personal de práctica. **No es un ambiente
productivo con clientes reales**, pero igual escribe datos: seed de
`mi-negocio`, tiendas `e2e-*`, usuarios de Auth y reservas de prueba.

## 2. Emulador local

```bash
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8090
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9098
export GCP_PROJECT_ID=demo-test   # el mismo --project del emulador
export EMPLOYEE_TOKEN_KEY=dev-employee-token-key-minimum-32-chars!!
export CRON_SECRET=dev-cron
export FRONTEND_URL=http://localhost:5173

cd backend
go run .
```

En otra terminal:

```bash
cd frontend
npm run test        # unitarios
npx playwright test # booking-pom + horarios
```

El Admin SDK, el backend y los tokens del emulador de Auth deben usar el mismo
project ID (`demo-test`) o falla el `aud` del ID token.

Para la colección de API local:

```bash
cd backend && go run seed.go   # con SEED_ALLOW_PROD=1 y GCP_PROJECT_ID=demo-test
cd frontend && node e2e-tests/clean-demo.mjs  # borra reservas demo
cd ../tests/api
TOKEN=$(node get-token.mjs)
newman run turnobot.postman_collection.json \
  -e turnobot.postman_environment.json \
  --env-var "idToken=$TOKEN" --env-var "baseUrl=http://localhost:8080"
```

`clean-demo.mjs` solo borra reservas de `mi-negocio`; no borra el negocio ni
sus servicios/empleados. La colección usa un teléfono aleatorio por corrida
para no chocar con el rate limit de reservas.

## 3. Preparación única para GCP

```bash
gcloud auth login
gcloud config set project stalwart-coast-439901-d0
gcloud auth application-default login
```

`application-default login` es distinto de `gcloud auth login`: el Admin SDK
de Node usa las credenciales de aplicación (ADC), no las de `gcloud` CLI.

Verificá que el archivo exista:

```bash
ls -l "$HOME/.config/gcloud/application_default_credentials.json"
```

Si preferís un service account, definí `GOOGLE_APPLICATION_CREDENTIALS` con la
ruta al JSON. No lo commitees.

## 4. Comandos

### Suite segura contra GCP

```bash
cd frontend
npm run test:e2e:gcp:safe
```

Corre `booking-pom`, `booking`, `multi-tenant` y `demo-reserva`.

### Suite completa contra GCP

```bash
cd frontend
npm run test:e2e:gcp
```

Incluye admin, CRM, reglas de negocio, visual y el flujo real. `smoke-prod`
queda omitido salvo que pidas explícitamente `SMOKE_PROD=1`.

### Smoke explícito

```bash
cd frontend
npm run test:e2e:gcp:smoke
```

### Sembrar datos sin correr tests

```bash
cd frontend
npm run test:e2e:seed
```

Crea/repone `mi-negocio`, `e2e-tienda` y el cliente `cliente-e2e@turnobot.test`.

### Resetear reservas de la tienda demo

```bash
cd frontend
node e2e-tests/clean-demo.mjs
```

Borra solo las reservas de `mi-negocio`. Útil antes de la colección de API o
para liberar el turno de las 10:00 en local.

### Limpiar datos `e2e-*`

Primero en seco:

```bash
cd frontend
npm run test:e2e:clean
```

Después, con confirmación:

```bash
npm run test:e2e:clean -- --yes
```

El script solo borra slugs con prefijo `e2e` (y `E2E_SLUG_PREFIX` si lo
cambiás). No toca `mi-negocio`.

### API con Newman

```bash
./scripts/run-api-gcp.sh
```

Limpia reservas demo, siembra, obtiene un `idToken` real y corre la
colección con `tests/api/turnobot.gcp.postman_environment.json`. La
colección genera un teléfono único por corrida para evitar el rate limit por
teléfono.

### Atajos

```bash
./scripts/run-qa-gcp.sh --safe
./scripts/run-qa-gcp.sh
./scripts/run-qa-gcp.sh --smoke
```

## 5. Guardias de seguridad

- `E2E_TARGET=gcp` exige `E2E_ALLOW_GCP=1`; los npm scripts ya lo ponen.
- En GCP no deben estar definidas `FIRESTORE_EMULATOR_HOST` ni
  `FIREBASE_AUTH_EMULATOR_HOST`. La suite aborta si las encuentra.
- En local, la suite aborta si faltan esas variables del emulador.
- `smoke-prod.spec.js` exige `SMOKE_PROD=1` además de GCP.
- `admin.spec.js` ya no borra `mi-negocio` al probar slug duplicado; solo limpia
  su negocio temporal `e2e-dupe-*`.
- `cleanup-staging.mjs` es dry-run por defecto y solo borra prefijos `e2e`.

## 6. Datos que usa la suite

| Slug | Para qué |
|---|---|
| `mi-negocio` | Tienda demo: `booking-pom`, `demo-reserva`, `demo-admin` |
| `e2e-tienda` | Tienda estable: `booking`, `visual` |
| `e2e-alfa`, `e2e-beta` | Aislamiento multi-tenant |
| `e2e-<timestamp>` | Admin, CRM, reglas, flujo real, smoke |
| `cliente-e2e@turnobot.test` | Cliente autenticado para confirmar reservas |

`mi-negocio` conserva su `owner_uid` si ya existía. El seed usa `merge` para no
pisar campos que no administra la suite.

## 7. CI

`.github/workflows/qa.yml` sigue usando **emulador** y variables dummy: no
necesita secretos ni ADC. El modo GCP es para tu máquina o un nightly manual,
no para cada pull request.

## 8. Troubleshooting

| Error | Causa | Solución |
|---|---|---|
| `Falta autenticación para el Admin SDK` | No hay ADC | `gcloud auth application-default login` |
| `Modo GCP con variables de emulador activas` | La terminal quedó con exports viejos | `unset FIRESTORE_EMULATOR_HOST FIREBASE_AUTH_EMULATOR_HOST` |
| `Modo local sin emulador` | Faltan exports | Exportá ambos hosts o usá `E2E_TARGET=gcp` |
| `INVALID_LOGIN_CREDENTIALS` al confirmar | El cliente E2E no existe | `npm run test:e2e:seed` |
| `INVALID_LOGIN_CREDENTIALS` en local | Emulador Project ID distinto de `demo-test` | `GCP_PROJECT_ID=demo-test` y mismo `--project` |
| `ID token has invalid 'aud'` | Project ID del backend/Auth no es `demo-test` | Exportá `demo-test`, no el ID de GCP |
| `rate_limited` / 429 en `/book` | Bucket por IP+negocio o por teléfono agotado | Esperá 1 minuto o usá `clean-demo.mjs`; la colección usa teléfonos únicos |
| 409 en la colección | Ya existe una cita en ese slot | `node e2e-tests/clean-demo.mjs` y corregí la fecha si usás un teléfono fijo |
| `EMAIL_EXISTS` en API | El usuario ya existía | Es normal; `get-token.mjs` hace login |
| Visual falla por snapshot | Cambió el seed o la UI | Revisá el diff; si es esperado, actualizá la base |
