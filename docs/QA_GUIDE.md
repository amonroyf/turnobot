# Guía de QA y Automatización — Turnobot

> Guía educativa para estudiantes de QA. Explica qué se prueba, cómo se prueba, cómo se ejecuta y cómo extender la cobertura.

## 1. Filosofía: la pirámide de pruebas

```
        /\
       /E2E\        <- pocos, lentos, frágiles (Playwright)
      /------\
     /  API   \     <- moderados (Newman/Postman)
    /----------\
   / Unitarios  \   <- muchos, rápidos, estables (Go/Vitest)
  /--------------\
```

- **Unitarios (base)**: lógica pura y handlers aislados. Rápidos, baratos. Viven en `backend/*_test.go` y `frontend/src/*.test.js`.
- **API/Contrato**: validan el contrato HTTP (status, JSON, campos). Viven en `tests/api/`.
- **E2E**: flujos completos de usuario en navegador. Viven en `frontend/e2e-tests/` y por defecto apuntan a GCP; el emulador es el modo local explícito.
- **No funcionales**: performance (k6), seguridad (OWASP ZAP), accesibilidad (axe).

**Regla de oro**: si un bug se puede detectar en un test unitario, no lo subas a E2E.

## 2. Estructura de archivos

```
turnobot/
├── backend/*_test.go          # Go: unitarios + integración (emulador)
├── backend/harness_test.go    # arnés: delta de Firestore por llamada
├── frontend/src/*.test.js(x)  # Vitest: lógica y componentes
├── frontend/e2e-tests/        # Playwright: E2E + visuales
├── frontend/e2e-tests/pages/  # Page Object Model
├── tests/api/                 # Postman + Newman
├── tests/perf/                # k6
├── docs/QA_GUIDE.md           # esta guía
├── docs/BITACORA.md           # bitácora de aprendizaje
├── docs/NOTAS_CODIGO.md       # reglas de negocio extraídas del código
├── docs/bugs/                 # bug reports
├── scripts/run-qa.sh          # ejecuta todo local
├── harness.sh                 # orquestador local (emulador + backend + vite + Playwright)
└── .github/workflows/qa.yml   # CI/CD
```

## 3. Cómo ejecutar cada capa

### 3.1 Backend (Go)

**Unitarias (siempre locales):** corren sin emulador y omiten la integración.
```bash
cd backend
go test ./... -count=1
```

**Integración local:** requiere emulador Firestore/Auth levantado (ver README principal).
```bash
cd backend
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8090
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9098
export GCP_PROJECT_ID=demo-test   # el mismo --project con el que arranca el emulador
export EMPLOYEE_TOKEN_KEY=dev-employee-token-key-minimum-32-chars!!
go test ./... -v -count=1 -coverprofile=coverage.out
go tool cover -html=coverage.out -o coverage.html   # reporte HTML
```

### 3.2 Frontend unitario (Vitest)
```bash
cd frontend
npm run test          # una corrida
npm run test -- --watch   # modo watch (TDD)
```

### 3.3 E2E (Playwright)

GCP es el modo por defecto. Requiere ADC (`gcloud auth application-default login`).
```bash
cd frontend
npm run test:e2e                    # GCP, suite completa
npm run test:e2e:gcp:safe           # GCP, subconjunto de bajo riesgo
npm run test:e2e:local              # emulador (PRs/TDD)
npx playwright show-report          # reporte HTML
```

> ⚠️ `--list` **no** ejecuta el `globalSetup`, así que **no valida la guardia** de
> entorno. Para probarla, ejecutá un spec de verdad: `npx playwright test
> e2e-tests/booking-pom.spec.js`. La guardia (`assertTargetReady` en
> `e2e-tests/target.js`) bloquea GCP sin `E2E_ALLOW_GCP=1`, bloquea GCP con
> variables de emulador activas, y bloquea local sin emulador.

### 3.3b Harness de tests Go (delta de Firestore)

Los tests de handlers pasan por un arnés que graba el estado de Firestore antes
y después de cada llamada, calcula el delta y deja un reporte JSON.

```bash
cd backend
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8090
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9098
export GCP_PROJECT_ID=demo-test      # debe coincidir con el --project del emulador

go test ./... -count=1
ls test-reports/                    # un JSON por llamada al handler
```

| Variable | Default | Para qué |
|----------|---------|----------|
| `QA_TEST_REPORTS` | (activo) | `0` desactiva la escritura de reportes |
| `QA_TEST_REPORT_DIR` | `test-reports` | Carpeta destino de los JSON |
| `QA_EMULATOR_PROJECT_ID` | `demo-test` | Project ID del emulador (debe coincidir con el `--project`) |

**El project ID tiene que ser el mismo en los tres lados**: emulador, backend y
tests. Si no, el ID token de Auth llega con un `aud` distinto y `VerifyIDToken`
responde 401. Es la causa raíz del BUG-003.

Un reporte se ve así:

```json
{
  "test_name": "TestBookHappyPath",
  "status": "pass",
  "response": { "status_code": 201 },
  "db_delta": {
    "reservas": { "GYv8tDnQiSlXsiGEL5hx": { "status": "added" } },
    "clientes": { "test-book-...__+573001234567": { "status": "added" } }
  }
}
```

Un `delta` vacío en un caso de error es la prueba de que el handler **no
escribió nada**: es evidencia que un assert de status code no da.

### 3.4 API (Newman)

**GCP (default):** siembra, obtiene un token real y corre la colección contra el
backend desplegado.
```bash
./scripts/run-api-gcp.sh
```

**Local con emulador:**
```bash
# 1. Obtener token del emulador
cd tests/api
node get-token.mjs > /tmp/token.txt
# 2. Ejecutar colección
newman run turnobot.postman_collection.json \
  -e turnobot.postman_environment.json \
  --env-var "idToken=$(cat /tmp/token.txt)" \
  --env-var "baseUrl=http://localhost:8080"
```

### 3.5 Performance (k6)
```bash
k6 run tests/perf/load.js -e BASE_URL=http://localhost:8080 -e SLUG=mi-negocio
```

### 3.6 Todo de una vez
```bash
./scripts/run-qa.sh             # GCP (default)
./scripts/run-qa.sh --local     # emulador
```

## 4. Cómo agregar un test nuevo (tutorial)

### 4.1 Test unitario Go (handler)
1. Abre `backend/handlers_test.go` y copia un test existente (ej. `TestBookHappyPath`).
2. Cambia el slug con `slugUnico("test-mi-caso")`.
3. Siembra datos con `seedTienda`.
4. Llama al handler vía `httptest` o helper.
5. Aserciones con `t.Fatalf` / `t.Errorf`.
6. Ejecuta solo ese test: `go test -run TestMiCaso -v`.

**Patrón AAA (Arrange-Act-Assert)**:
```go
func TestEjemplo(t *testing.T) {
    // Arrange
    testFirestoreClient(t)
    ctx := context.Background()
    slug := slugUnico("test-ejemplo")
    seedTienda(t, ctx, slug)

    // Act
    code, out := postBook(t, slug, map[string]string{...})

    // Assert
    if code != http.StatusCreated { t.Fatalf("code=%d", code) }
}
```

### 4.2 Test de componente React (Vitest)
1. Crea `src/MiComponente.test.jsx`.
2. Usa `render`, `screen`, `fireEvent` de Testing Library.
3. Aserciones con `expect(...).toBeInTheDocument()`.

### 4.3 Test E2E (Playwright) con Page Object
1. Crea un Page Object en `e2e-tests/pages/`.
2. Crea el spec en `e2e-tests/`.
3. Usa `test.describe` + `test()`.
4. Aserciones con `expect(...).toBeVisible()`.

### 4.4 Test de API (Postman)
1. Abre la colección en Postman.
2. Agrega un request.
3. En la pestaña "Tests" escribe aserciones con `pm.test`.
4. Exporta la colección y commitea el JSON.

## 5. CI/CD (GitHub Actions)

El workflow `.github/workflows/qa.yml` ejecuta en cada push/PR a `main` con
**emulador local** (sin secretos):
1. **backend**: tests Go + cobertura.
2. **frontend-unit**: Vitest.
3. **api**: Newman (requiere backend + emulador).
4. **e2e**: Playwright local (`E2E_TARGET=local`) + reporte Allure.
5. **perf**: k6 (solo manual, `workflow_dispatch`).

`.github/workflows/qa-gcp.yml` corre a demanda contra GCP: E2E seguro/completo,
Newman o la integración Go, con WIF y `GCP_TEST_ALLOW_WRITES=1`.

Los reportes (cobertura, Allure) se suben como artifacts descargables desde la pestaña "Actions".

## 6. Metas de cobertura

| Capa | Meta | Actual (referencia) |
|------|------|---------------------|
| Backend (Go) | ≥ 80% | ~62% (mejorar con tests de handlers) |
| Frontend (Vitest) | ≥ 70% | por medir |
| E2E (Playwright) | flujos críticos (reserva, cancel, admin) | parcial |

Para medir cobertura frontend: `npx vitest run --coverage` (requiere `@vitest/coverage-v8`).

## 7. Aprendizaje recomendado (8 semanas)

| Semana | Tema | Ejercicio |
|--------|------|-----------|
| 1 | Pirámide de pruebas + Git | Leer esta guía, clonar, correr `run-qa.sh` |
| 2 | Unitarios Go | Escribir 3 tests nuevos para handlers sin cobertura |
| 3 | Vitest + Testing Library | Cubrir 2 componentes React |
| 4 | Playwright + POM | Refactorizar 1 spec a POM |
| 5 | API testing (Postman/Newman) | Agregar 5 requests a la colección |
| 6 | CI/CD | Entender y modificar el workflow de GitHub Actions |
| 7 | Performance (k6) | Crear escenario de carga para `/slots` |
| 8 | Seguridad + Accesibilidad | Ejecutar OWASP ZAP y axe sobre el frontend |

## 8. Troubleshooting

- **"sin emulador"**: para el modo local, asegúrate de que `FIRESTORE_EMULATOR_HOST=127.0.0.1:8090` esté exportado y el emulador corriendo. Para GCP, usá ADC y quitá esas variables.
- **"Modo GCP bloqueado"**: falta `E2E_ALLOW_GCP=1`; los scripts `npm run test:e2e*` ya lo exportan.
- **401 `invalid 'aud' claim`**: el project ID del emulador, el del backend y el de los tests **no coinciden**. Usá `demo-test` en los tres (o exportá `QA_EMULATOR_PROJECT_ID`). Es el BUG-003.
- **Los tests Go se omiten en silencio**: el emulador de **Auth** no está corriendo o falta `FIREBASE_AUTH_EMULATOR_HOST`. Corré `go test -v` y contá los SKIP: "verde" con 85 omitidos no es verde.
- **Playwright no encuentra navegador**: `npx playwright install chromium`.
- **Newman 401**: el token expiró; vuelve a ejecutar `get-token.mjs`.
- **Cobertura no sube**: los handlers de push/Calendar requieren mocks; céntrate en lógica pura y handlers de reservas.
- **El harness crashea con `comparing uncomparable type`**: sería el BUG-002, ya corregido. Si vuelve, es que alguien reintrodujo un `==` en `equalDocs`.

## 9. Glosario rápido

- **AAA**: Arrange-Act-Assert, patrón de estructura de tests.
- **POM**: Page Object Model, encapsula selectores de UI.
- **Flaky test**: test que pasa/falla aleatoriamente (evitar con waits explícitos).
- **Coverage**: porcentaje de código ejecutado por los tests.
- **Contract test**: valida que la API respete su contrato (campos, tipos, status).
- **Smoke test**: prueba mínima de que el sistema arranca.
- **Regression**: re-ejecutar tests para detectar roturas por cambios.

## 10. Recursos

- Go testing: https://go.dev/doc/tutorial/add-a-test
- Vitest: https://vitest.dev
- Playwright: https://playwright.dev
- Newman: https://learning.postman.com/docs/collections/using-newman-cli/
- k6: https://k6.io/docs
- Allure: https://docs.qameta.io/allure/
- ISTQB (fundamentos): https://www.istqb.org

---
*Generado para el proyecto Turnobot — uso educativo.*