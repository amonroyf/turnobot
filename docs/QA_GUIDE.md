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
├── frontend/src/*.test.js(x)  # Vitest: lógica y componentes
├── frontend/e2e-tests/        # Playwright: E2E + visuales
├── frontend/e2e-tests/pages/  # Page Object Model
├── tests/api/                 # Postman + Newman
├── tests/perf/                # k6
├── docs/QA_GUIDE.md           # esta guía
├── scripts/run-qa.sh          # ejecuta todo local
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
- **Tests Go fallan por auth**: verifica `FIREBASE_AUTH_EMULATOR_HOST` y que el proyecto sea `stalwart-coast-439901-d0` (o `demo-test` consistente).
- **Playwright no encuentra navegador**: `npx playwright install chromium`.
- **Newman 401**: el token expiró; vuelve a ejecutar `get-token.mjs`.
- **Cobertura no sube**: los handlers de push/Calendar requieren mocks; céntrate en lógica pura y handlers de reservas.

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