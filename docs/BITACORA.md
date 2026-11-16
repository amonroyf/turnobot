# Bitácora QA

> Registro de aprendizaje del plan de 14 semanas (`docs/PLAN_QA.md`).
> Una entrada por sesión. Se escribe al cierre del día, no durante.

---

## Semana 1 — lunes 16 nov 2026

- **Entregable de la semana:** suite corrida + bug #1 estudiado + riesgo #2 identificado + bitácora
- **¿Está hecho?** parcial — falta el bloque de búsqueda laboral

### Qué hice

1. **Diagnóstico del entorno** antes de tocar nada: Node 22.23.5, npm 10.9.9, Go 1.27.2,
   Java 21, Playwright 1.65.1, ADC configurada, `node_modules` instalado.
2. **Correr las tres capas** y ver qué pasa de verdad:
   - Vitest: **43/43 pasan** en 5.4 s (5 archivos).
   - Go: **19 pasan / 85 se omiten** sin emulador (los de integración);
     **104/104 en verde** con emulador Firestore+Auth.
   - Playwright `--list`: **33 tests / 12 specs** en modo GCP, **5 / 2** en local.
3. **Arreglé y expandí el harness de tests** (commit `48ff6d4`) — el pedido central del día.
4. **Leí el código de la app**: `backend/main.go` (handlers de reserva), `frontend/src/fecha.js`,
   `turnobot-test-learn/sandbox/` (el arnés de interceptación).

### Los 3 bugs reales que encontré (y corregí)

| # | Dónde | Problema | Impacto | Evidencia |
|---|-------|----------|---------|-----------|
| A | `sandbox/delta.go` | `equalDocs` usaba `a == b`, que **entra en panic** con arrays (`comparing uncomparable type []interface{}`) | Los docs de Turnobot tienen arrays (`turnos`, `servicios_ids`, `participantes`): el harness crasheaba justo cuando había algo que reportar | Reproducido aislado en `/tmp/opencode/qa`: `PANIC CONFIRMADO` |
| B | `backend/gcp_test.go` | `testProjectID()` devolvía `test-turnobot` hardcodeado, pero **todo el repo usa `demo-test`** (docs, `seed.go`, `run-qa.sh`, `target.js`) | Con el emulador arrancado como dice la documentación, **77 tests fallaban** con 401 `invalid 'aud' claim` | Baseline medido con `git stash`: 77 fallos → 0 tras el fix |
| C | `harness.sh` | `cleanup()` hacía `rm -f firebase.emu.json`, que **está versionado en git** | Cada corrida dejaba el repo sucio | `git ls-files --error-unmatch firebase.emu.json` |

Extras que salieron en el camino:

- `harness.sh` levantaba **solo Firestore, sin Auth** → los tests que necesitan token se
  omitían en silencio y el harness decía "Backend tests pasaron".
- Los reportes al TMS iban a `localhost:8080`, que **ocupa el backend de Turnobot**:
  el POST caía al servicio equivocado y se perdía en un 404 silencioso.
- `Snapshot` solo leía colecciones de raíz: `empleados`, `servicios` y `recursos`
  (subcolecciones de `negocios/{slug}`) quedaban fuera del reporte.
- `log.SetOutput(oldStderr)` pisaba el destino previo del logger.
- Un test con **dos** llamadas al handler sobrescribía su reporte (solo quedaba el último).
  Ahora cada llamada tiene su archivo (`_2`, `_3`, ...).

### Qué entendí (lo que el harness me enseñó)

- **Un assert de status code no dice si el handler escribió lo que debía.**
  El delta de Firestore sí. `TestBookHappyPath` → `reservas/GYv8...: added` +
  `clientes/...: added`. `TestBookTelefonoInvalido` → 400 y **0 documentos escritos**.
  Ese contraste es la prueba real, y antes no existía en el repo.
- **El `aud` del token de Auth es una contract.** El project ID del emulador, el del
  backend y el de los tests tienen que ser el mismo string. No es un detalle: es lo
  que separa "el test falla porque el bug existe" de "el test falla porque el entorno
  está mal armado".
- **"Pasó" ≠ "se probó".** 85 tests omitidos siguen contando como verde en el exit code.
  Hay que leer el `-v` para ver cuántos corrieron de verdad.

### Qué me trabó

- El `pkill` que usé para bajar el emulador mató también mi propio shell en background
  (el patrón matcheaba la línea de comando del proceso). Resolver: matar por PID.
- Perdí tiempo en un `edit` con `oldString` que no calzaba por whitespace. El `read`
  mostraba el archivo con indentación distinta a la real: hay que re-leer con offsets
  chicos antes de editar.

### Dudas aparcadas (no perseguir hoy)

- El TMS (`turnobot-test-learn/backend`) expone requirements/cases/suites/defects/traceability
  pero **solo escribe en la colección `test_runs`**. ¿Lo conecto de verdad o lo descarto?
- `runTestsHandler` del TMS dispara un Cloud Build que clona `github.com/amonroyf/turnobot.git`
  y corre `go test` con `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` — puertos que no
  coinciden con los del emulador local. Seems dead code.
- El plan dice 33 tests E2E en GCP; el `--list` lo confirma. Pero ninguno se ejecutó hoy.

### El semáforo de specs E2E — CORREGIDO (el del plan está desactualizado)

El plan (§1.2) clasifica los specs por "local vs GCP". **Esa clasificación no se
corresponde con el código.** Verifiqué spec por spec:

| Spec | Tests | Plan dice | Realidad |
|------|-------|-----------|----------|
| `booking-pom.spec.js` | 2 | 🟢 local, sin login | ⚠️ Depende del `globalSetup` (siembra `mi-negocio`) y busca el negocio **`mi-negocio`**, no `e2e-tienda`. No es "sin login": requiere backend + frontend arriba |
| `horarios.spec.js` | 3 | 🟢 local, sin login | ⚠️ Igual: corre `globalSetup`, que siembra datos. Sin backend/frontend no pasa |
| `booking.spec.js` | 3 | 🔵 GCP | ✅ Correcto. Usa `signInEnPagina` → necesita Auth real → GCP |
| `multi-tenant.spec.js` | 2 | 🔵 GCP | ✅ Correcto |
| `demo-reserva.spec.js` | 1 | 🔵 GCP | ✅ Correcto |
| `admin.spec.js` | 3 | 🔵 GCP | ✅ Correcto |
| `crm.spec.js` | 1 | 🔵 GCP | ✅ Correcto |
| `real-flow.spec.js` | 3 | 🔵 GCP | ✅ Correcto |
| `reglas-negocio.spec.js` | 6 | 🔵 GCP | ✅ Correcto |
| `demo-admin.spec.js` | 1 | 🔵 GCP | ✅ Correcto |
| `visual.spec.js` | 7 | 🟡 visual | ✅ Correcto |
| `smoke-prod.spec.js` | 1 | 🔴 explícito | ✅ Correcto: `test.skip` salvo `SMOKE_PROD=1` |

**Conclusión:** el corte real no es "local vs GCP" sino **"¿el spec necesita un
cliente autenticado?"**. 9 de 12 specs usan `signInEnPagina` (login real contra
Auth). Solo 2 (`booking-pom`, `horarios`) no hacen login — pero igual dependen del
seed del `globalSetup`. **Ningún spec es totalmente autónomo.**

### La guardia de seguridad (ítem 7) — verificada empíricamente

`assertTargetReady()` — `frontend/e2e-tests/target.js:40-80`, llamado desde
`global-setup.js:10`. La probé con 3 escenarios:

| Escenario | Resultado |
|-----------|-----------|
| `E2E_TARGET=gcp` sin `E2E_ALLOW_GCP` | ❌ Falla rápido: *"Modo GCP bloqueado"* (target.js:43) |
| `E2E_TARGET=gcp` + emulador activo | ❌ Falla: *"Modo GCP con variables de emulador activas"* (target.js:52) |
| `E2E_TARGET=local` sin emulador | ❌ Falla rápido: *"Modo local sin emulador"* (target.js:75) |

⚠️ **Un detalle que el plan no menciona:** la guardia vive en el `globalSetup`, y
**`--list` NO ejecuta el `globalSetup`**. Con `--list` las tres escenarios pasan
sin error. O sea: `npm run test:e2e -- --list` **no valida nada** — es solo un
listado. Para probar la guardia hay que ejecutar un spec de verdad.

### Bug #1 (ítem 6) — confirmado

`git show d434434 -- frontend/package.json` muestra el fix: se agregó
`"test": "vitest run"`. Antes, `scripts/run-qa.sh` llamaba `npm run test` y ese
script **no existía** → el runner de QA fallaba siempre, en la primera capa.
Hoy `npm run test` → 43/43 en verde.

### Evidencia

- Commit `48ff6d4` — "test(qa): extiende el harness de interceptación a todos los handlers"
- `backend/test-reports/` — 178 reportes JSON, 98 con delta real en `reservas`
- `frontend/` → 43/43 Vitest | `backend/` → 104/104 Go con emulador | 0 fallos

### Próximo paso (uno solo)

**Leer el código del flujo de reserva** (`backend/main.go` → `bookHandler`, y
`frontend/src/BookingApp.jsx`) y escribir en la bitácora qué reglas de negocio se
pueden derivar de ahí — es el insumo para la matriz de riesgo de la semana 10.

---

## Plantilla (copiar para cada semana)

```markdown
## Semana N — [fecha]
- Entregable de la semana:
- ¿Está hecho? sí / no
- Qué aprendí (3 bullets):
- Qué me trabó:
- Dudas aparcadas (para no perseguirlas hoy):
- Evidencia (link a commit, test, reporte):
- Próximo paso (uno solo):
```
