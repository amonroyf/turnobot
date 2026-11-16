# Plan de estudio QA Automation — 14 semanas con Turnobot

> **Para quién:** persona que ya programa y tocó algo de testing, con inglés básico, mercado Colombia, 15+ h/semana.
> **Meta:** primer empleo como QA Automation Jr. en 3–4 meses, usando Turnobot como proyecto real.
> **Inicio:** lunes 16 de noviembre de 2026 · **Fin:** domingo 21 de febrero de 2027.
> **Regla base:** una semana a la vez. No leas el detalle de las semanas futuras hasta que te toque.
>
> **Actualización GCP-first:** la suite E2E/API apunta a GCP por defecto
> (`npm run test:e2e`, `npm run test:e2e:gcp:safe`, `./scripts/run-api-gcp.sh`).
> El emulador es el modo local explícito (`npm run test:e2e:local`,
> `./scripts/run-qa.sh --local`) y es el que usan los PRs. Para la integración
> Go contra GCP hacen falta `GCP_TEST_PROJECT_ID` y `GCP_TEST_ALLOW_WRITES=1`.

---

## Resumen en 30 segundos

- **14 semanas, 4 fases:** fundamentos + unitarios → API → E2E + CI → no funcionales + portfolio.
- **15 h/semana:** lunes a jueves 2,5 h, viernes libre, sábado 4 h, domingo 1 h de cierre.
- **Una semana = un entregable.** Si no está hecho, no avanzás; repetís o usás el colchón.
- **Tu primer bug real ya está resuelto:** faltaba `npm run test`; se agregó en el commit `d434434`. En la semana 1 lo estudiás y pasás al riesgo #2 (E2E contra producción).
- **Antes de cualquier E2E:** elegí modo. Local = emulador encendido y variables exportadas. GCP = ADC configurada y `E2E_TARGET=gcp`. Si no sabés en qué modo estás, no corras.
- **No leas todo:** abrí la semana actual y hacé el primer ítem sin marcar.

---

## 0. Cómo usar este plan (leer solo esto el primer día)

1. Abrí únicamente la **semana actual**. No leas las 14 de corrido.
2. Cada semana tiene **un entregable**. Si no está hecho, no avances: repetí o usá la semana de colchón.
3. Si te atrasás, **recortá lo opcional** (marcado ○). Nunca recortes API, E2E, CI y portfolio.
4. Si no sabés qué hacer hoy: abrí la semana actual y hacé **el primer ítem sin marcar**.
5. El viernes es libre. El domingo son 60 minutos de cierre, no de aprendizaje nuevo.
6. Todo se practica en Turnobot, en una rama `qa-learning`. No toques `main` ni producción.

**Criterio de éxito del plan (no es “terminar el curso”):**

- [ ] Escribir un test desde cero, en 30 minutos, sin copiar.
- [ ] Explicar en voz alta qué probaste y por qué.
- [ ] Detectar un test frágil y arreglarlo.
- [ ] Tener 15–20 tests propios, 3 bug reports y un pipeline en verde.
- [ ] Postularte a 10 ofertas con evidencia real.

---

## 1. Diagnóstico: qué hay hoy en Turnobot

| Capa | Qué existe | Estado real (verificado) | Comando |
|------|-----------|--------------------------|---------|
| Unitarios frontend | 5 archivos Vitest | **43 tests pasan** en ~5 s | `cd frontend && npx vitest run` |
| Unitarios backend | 7 archivos Go | Corren; los de integración se **omiten** sin emulador | `cd backend && go test ./...` |
| Integración Go | `handlers_test.go` | Requiere emulador Firestore + Auth | ver §9 |
| E2E | 12 specs, **33 tests GCP / 5 locales** | GCP es el default; local usa emulador y es explícito (ver semáforo) | `npm run test:e2e -- --list` |
| API | Colección Postman + Newman | Necesita backend + seed + token | ver §9 |
| Performance | `tests/perf/load.js` | Script listo; **k6 no está instalado** | ver semana 13 |
| CI | `.github/workflows/qa.yml` | Existe; el job E2E es dudoso (auth real) | revisar semana 11 |

**Herramientas de tu máquina:** Node 22.23, npm 10.9, Go 1.27, Java 21, Docker 29.9, Playwright 1.63, `node_modules` instalado.
**Faltan:** Firebase CLI (usá `npx firebase-tools`) y k6 (semana 13).

### 1.1. Hallazgos reales (tu primer material de QA)

No son fracasos: son bugs y riesgos reales. Algunos ya están resueltos; los demás son tus ejercicios.

| # | Archivo | Problema | Impacto | Estado |
|---|---------|----------|---------|--------|
| 1 | `frontend/package.json` + `scripts/run-qa.sh` | No existía `npm run test`, pero el script lo llamaba | `./scripts/run-qa.sh` fallaba siempre | ✅ Resuelto en `d434434` (alias `test`) |
| 2 | `frontend/e2e-tests/global-setup.js` y `setup.js` | Admin SDK apunta al proyecto real, sin guardia de emulador | Si tenés credenciales de Google, **puede escribir en producción** | ✅ Mitigado: `E2E_TARGET=local/gcp` + `E2E_ALLOW_GCP=1` + ADC obligatoria en GCP (ver `docs/QA_ENTORNOS.md`) |
| 3 | `frontend/e2e-tests/horarios.spec.js` | `API_BASE` por defecto es la URL de producción | Un test local pega contra prod | ✅ Resuelto: `API_BASE` sale de `target.js` (local en local, GCP en GCP) |
| 4 | `frontend/e2e-tests/reglas-negocio.spec.js`, `admin.spec.js`, `real-flow.spec.js`, `crm.spec.js` | Login contra `identitytoolkit.googleapis.com` real con API key hardcodeada | No son reproducibles en CI; tocan Auth real | ✅ Resuelto: specs de Auth solo en modo GCP; local los ignora y usa `signInEnPagina` |
| 5 | `frontend/e2e-tests/visual.spec.js` | Esperaba el servicio “Corte y Barba”, pero el seed creaba “Consulta General” | Fallaba en local | ✅ Resuelto: el seed de `e2e-tienda` crea “Corte y Barba” y `booking.spec` usa el mismo servicio |
| 6 | `frontend/playwright.config.js` | `workers: 1` y `retries: 1` | Puede ocultar colisiones y flakiness | Pendiente · semana 10–11 |
| 7 | `docs/QA_GUIDE.md` | Decía `npm run test`, que no existía | Confundía al que empieza | ✅ Resuelto: el alias ya existe y la guía es correcta |
| 8 | `frontend/e2e-tests/smoke-prod.spec.js` | Corría contra producción por defecto | Escribía/borraba datos reales sin querer | ✅ Resuelto: exige `SMOKE_PROD=1` y modo GCP |
| 9 | `frontend/e2e-tests/admin.spec.js` | Al probar slug duplicado borraba `mi-negocio` | Podía dejar la tienda demo sin datos | ✅ Resuelto: solo borra el negocio temporal `e2e-dupe-*` |
| 10 | `backend/gcp_test.go` | `testProjectID()` devolvía `test-turnobot` hardcodeado mientras **todo el repo usa `demo-test`** (docs, `seed.go`, `run-qa.sh`, `target.js`) | Con el emulador armado según la documentación, **77 de 104 tests de integración fallaban** con 401 `invalid 'aud' claim`. El síntoma parece un bug de auth | ✅ Resuelto en `48ff6d4`: default `demo-test`, override con `QA_EMULATOR_PROJECT_ID` → **0 fallos** |
| 11 | `turnobot-test-learn/sandbox/delta.go` | `equalDocs` usaba `a == b`, que **entra en panic** con arrays | Los docs tienen arrays (`turnos`, `servicios_ids`): el harness crashea justo cuando hay algo que reportar | ✅ Resuelto en `48ff6d4` (`reflect.DeepEqual`) |
| 12 | `harness.sh` | `cleanup()` borraba `firebase.emu.json`, que **está versionado en git** | Cada corrida dejaba el repo sucio | ✅ Resuelto en `48ff6d4`: guarda copia y restaura |
| 13 | `harness.sh` | Levantaba **solo Firestore, sin Auth** y no exportaba `FIREBASE_AUTH_EMULATOR_HOST` | Los tests que requieren token se **omitían en silencio** y el harness decía "pasaron" | ✅ Resuelto en `48ff6d4`: levanta `firestore,auth` y exporta ambas variables |
| 14 | `backend/paginacion_test.go` | Mandaba los reportes al TMS por `localhost:8080`, que **ocupa el backend de Turnobot** | El POST caía al servicio equivocado y se perdía en un 404 silencioso | ✅ Resuelto en `48ff6d4`: el TMS usa 8091 y el despacho es opcional |

### 1.2. Semáforo de specs E2E (importante)

> ⚠️ **Actualizado el 16 nov 2026 (semana 1).** El semáforo de abajo clasifica por
> "local vs GCP", pero **el código no lo respeta**. Verificado spec por spec:
> el corte real es **"¿el spec necesita un cliente autenticado?"**. 9 de 12 specs
> usan `signInEnPagina` (login real contra Auth) → requieren GCP.
> Solo `booking-pom.spec.js` y `horarios.spec.js` no hacen login — **pero igual
> dependen del `globalSetup`**, que siembra datos. **Ningún spec es autónomo.**
>
> Ojo extra: `booking-pom.spec.js` busca el negocio **`mi-negocio`**, mientras el
> resto de la suite siembra **`e2e-tienda`**. Son dos negocios de prueba distintos.
>
> ⚠️ **`--list` NO ejecuta el `globalSetup`**, así que
> `npm run test:e2e -- --list` **no valida la guardia**: lista sin comprobar nada.
> Para probar la guardia hay que ejecutar un spec de verdad.

| Semáforo | Specs | Regla |
|----------|-------|-------|
| 🟢 Local/emulador | `booking-pom.spec.js`, `horarios.spec.js` | Rápidos y sin login. Es la suite que corre por defecto en CI. **Ojo: ambos dependen del seed del `globalSetup`.** |
| 🔵 GCP práctica | `booking.spec.js`, `multi-tenant.spec.js`, `demo-reserva.spec.js`, `admin.spec.js`, `crm.spec.js`, `real-flow.spec.js`, `reglas-negocio.spec.js`, `demo-admin.spec.js`, `visual.spec.js` | Requieren ADC y `E2E_TARGET=gcp`. Escriben datos reales de práctica. |
| 🟡 Visual | `visual.spec.js` | Compara snapshots; si cambia el seed/UI, revisá el diff antes de actualizar la base. |
| 🔴 Solo explícito | `smoke-prod.spec.js` | Exige `SMOKE_PROD=1`; no corre en CI. |
| ⛔ Nunca en aprendizaje | `barberia-vip-prod.mjs`, `settings-prod.mjs` | Son scripts de producción, no tests. |

**Antes de cualquier E2E, elegí un modo:**

```bash
# Local: el emulador debe estar encendido
echo "FIRESTORE_EMULATOR_HOST=$FIRESTORE_EMULATOR_HOST"
echo "FIREBASE_AUTH_EMULATOR_HOST=$FIREBASE_AUTH_EMULATOR_HOST"

# GCP: ADC configurada y sin variables de emulador
gcloud auth application-default login
```

La guía completa de entornos está en `docs/QA_ENTORNOS.md`.

---

## 2. Reglas anti-saturación

1. **Una fuente por tema.** Documentación oficial o esta guía. Nada de 5 tutoriales en paralelo.
2. **Una capa por semana.** No mezcles Playwright con k6 y con Go la misma semana.
3. **Una herramienta nueva por semana como máximo.** Si aparece otra, va a la lista “después”.
4. **Un entregable por semana.** El checkbox manda, no las horas.
5. **Regla de los 20 minutos:** si estás trabado 20 min, escribí la duda en la bitácora y seguí con otra cosa.
6. **Si no llegás, recortás.** No acumules semanas: repetir es mejor que arrastrar.
7. **Viernes libre.** El descanso es parte del plan, no un premio.
8. **Comparate con tu yo de la semana pasada**, no con LinkedIn.
9. **Nada de producción.** Ni lectura, ni escritura, ni “solo probar”.
10. **Aprendizaje = poder explicarlo y poder hacerlo fallar.** Si solo copiaste, no aprendiste.

### Señales de que te estás saturando

- Tenés 8 pestañas abiertas y ninguna terminada.
- Cambiaste de tema sin cerrar el anterior.
- Copiaste código que no podés explicar.
- Estás ansioso por “llegar” y no dormís.

**Protocolo:** cerrá todo → hacé el ejercicio más pequeño posible (15 min) → escribí la duda → caminá 10 min → volvé a un solo ítem.

---

## 3. Método didáctico: ciclo de 90 minutos

Cada bloque de estudio sigue este orden. No lo cambies.

| Tiempo | Paso | Qué hacés |
|--------|------|-----------|
| 10 min | **Repaso activo** | Cerrá apuntes y explicá lo de la sesión anterior. Si no sale, ese es el tema de hoy. |
| 15 min | **Concepto mínimo** | Una sola fuente: qué es, para qué sirve, un ejemplo. Nada de historia. |
| 50 min | **Práctica** | Copiar → **romper** → arreglar → escribir de cero. |
| 10 min | **Bitácora** | 3 líneas: qué hice, qué entendí, qué quedó pendiente. |
| 5 min | **Explicar en voz alta** | Como si se lo contaras a alguien que no programa. |

### La secuencia que hace que aprendas de verdad

1. **Copiar** un test que ya pasa.
2. **Romperlo a propósito** (cambiá un valor esperado o un input) y leer el error.
3. **Arreglarlo** sin mirar la solución.
4. **Escribir uno nuevo desde cero**, con otro caso.
5. **Explicar** por qué ese caso importa.

> Ejemplo con `formatearTelefono`: copiás el test de 10 dígitos → cambiás el esperado → ves el fallo → agregás el caso de 9 dígitos → explicás por qué un número corto no debe formatearse igual.

### Repaso espaciado

- Día 1: lo aprendiste.
- Día 3: reescribí el test sin mirar.
- Día 7: explicá el concepto y corré el test.
- Si falla el repaso, no es un fracaso: es información.

---

## 4. Rutina semanal (15 h)

| Día | Horas | Qué |
|-----|-------|-----|
| Lunes a jueves | 2,5 h/día (10 h) | 90 min de bloque + 15 min de pausa + 45 min de práctica |
| Viernes | 0 | **Libre** |
| Sábado | 4 h | 3 h técnicas + 1 h de búsqueda laboral |
| Domingo | 1 h | Cierre: correr lo de la semana, bitácora, elegir el próximo paso |

**Si solo tenés 10 h/semana:** lunes a miércoles 2 h, sábado 3 h, domingo 1 h. Hacé solo lo marcado ⭐ y dejá lo ○.

**Reglas de energía:** dormir 7–8 h, caminar 20 min, no estudiar después de las 22:00 si al día siguiente trabajás, y no compensar un día perdido con una maratón de 6 h.

---

## 5. Mapa de 14 semanas

| Sem | Fechas | Foco | Capa | Entregable |
|-----|--------|------|------|------------|
| 1 | 16–22 nov | Arranque, diagnóstico y mapa | Todas | Suite corrida + bug #1 estudiado + riesgo #2 identificado + bitácora |
| 2 | 23–29 nov | Unitarios JS y diseño de casos | Unit frontend | 3 tests nuevos (8+ casos) |
| 3 | 30 nov–6 dic | Unitarios Go y tabla de casos | Unit backend | 2 tests Go + `go vet` limpio |
| 4 | 7–13 dic | Integración con emulador | Integración | 1 test de handler + diagrama |
| 5 | 14–20 dic | API manual y contrato | API | 3 requests con aserciones |
| 6 | 21–27 dic | Newman y CI de API (semana light) | API/CI | Suite Newman verde |
| 7 | 28 dic–3 ene | Bug reports + repaso + colchón | Transversal | 2 bug reports + autoevaluación |
| 8 | 4–10 ene | Playwright básico y seguridad | E2E | Guardia de emulador + 1 spec propio |
| 9 | 11–17 ene | Page Object Model y fixtures | E2E | 1 spec refactorizado + fixture |
| 10 | 18–24 ene | Flujos de negocio y riesgo | E2E | 2 tests E2E + matriz de riesgo |
| 11 | 25–31 ene | CI, reportes y flaky | CI | 3 corridas verdes + PR + reporte de flaky |
| 12 | 1–7 feb | Visual + accesibilidad | No funcional | Visual arreglado + reporte a11y |
| 13 | 8–14 feb | Performance + seguridad | No funcional | Reporte k6 + checklist de acceso |
| 14 | 15–21 feb | Portfolio, entrevistas y cierre | Transversal | Portfolio + 10 postulaciones + 2 simulacros |

---

## 6. Detalle semana a semana

### Semana 1 · 16–22 nov · Arranque y diagnóstico

**Meta:** entender la pirámide usando tu propio repo y dejar el entorno reproducible.

**Concepto (2 h):** niveles de prueba, verificación vs validación, test frágil, cobertura. Leé `docs/QA_GUIDE.md` §1–3 y §9. ISTQB capítulo 1 (1 h).

**Práctica (11 h):**

1. Creá la rama: `git switch -c qa-learning` (la base ya quedó commiteada en `d434434`).
2. Creá `docs/BITACORA.md` con la plantilla de §8.
3. `cd frontend && npx vitest run` → verificá 43 tests. Abrí `src/fecha.test.js` y marcá en un test dónde está Arrange, Act y Assert.
4. `cd backend && go test ./... -count=1` → anotá cuántos se omiten y por qué (leé `testFirestoreClient` en `handlers_test.go`).
5. `cd frontend && npm run test:e2e -- --list` → 33 tests en GCP; `npm run test:e2e:local -- --list` → 5 en local (emulador). Clasificá cada spec con el semáforo de §1.2.
6. `npm run test` → deben pasar 43 tests. El bug del script faltante ya se corrigió en `d434434`; mirá el cambio con `git show d434434 -- frontend/package.json` y anotá por qué `run-qa.sh` fallaba.
7. Leé `frontend/e2e-tests/target.js`, `global-setup.js` y `setup.js`: identificá la guardia que impide mezclar emulador con GCP. **No corras E2E contra GCP todavía**; solo analizalo. El bug #2 ya está mitigado; en la semana 8 vas a probar la guardia.
8. Leé `docs/QA_GUIDE.md` §1–3 y escribí en la bitácora: pirámide, un ejemplo de cada capa en Turnobot, y qué capa es más cara de mantener.

**Verificá:** `npm run test` corre y pasan 43 tests.

**Entregable:**

- [x] Rama `qa-learning`.
- [x] `docs/BITACORA.md` con tres listas: qué corre, qué no, qué no entiendo.
- [x] Bug #1 documentado como caso resuelto (commit `d434434`).
- [x] Bug #2 identificado por escrito (sin correr E2E).
- [x] Semáforo de specs completo.

> ### ✅ Estado real al 16 nov 2026 (fin de la sesión)
>
> | Ítem | Estado | Dato verificado |
> |------|--------|-----------------|
> | 1. Rama `qa-learning` | ⚠️ **No creada** | Se trabajó sobre `main` (decisión del usuario). |
> | 2. `docs/BITACORA.md` | ✅ Hecho | + `docs/NOTAS_CODIGO.md` |
> | 3. Vitest + AAA en `fecha.test.js` | ✅ Hecho | **43/43** en 5,4 s (5 archivos) |
> | 4. `go test` + `testFirestoreClient` | ✅ Hecho | Sin emulador: **19 pasan / 85 omiten**. Con emulador: **104/104, 0 fallos** |
> | 5. `--list` + semáforo | ✅ Hecho | **33 tests / 12 specs** GCP, **5 / 2** local. Semáforo **corregido** (ver §1.2) |
> | 6. `npm run test` + bug #1 | ✅ Hecho | `git show d434434` confirma el alias faltante |
> | 7. La guardia de emulador | ✅ Hecho | Probada con 3 escenarios: **falla rápido** en los 3. Ojo: `--list` no la dispara |
> | 8. `QA_GUIDE.md` §1–3 + bitácora | ✅ Hecho | Pirámide documentada en la bitácora |
> | Extra | ✅ | **Harness expandido** (commit `48ff6d4`): 3 bugs corregidos, 178 reportes JSON, 98 con delta real |
> | Búsqueda laboral | ✅ Hecho | `docs/BUSQUEDA_LABORAL.md`: 10 ofertas, top 5 requisitos, gaps |
>
> **Entregables adicionales no pedidos que salieron de leer el código:**
> - `docs/bugs/BUG-002.md` — el panic del harness con arrays.
> - `docs/bugs/BUG-003.md` — el project ID inconsistente (77 tests rotos).
> - **25 reglas de negocio sin cobertura** (extraídas de los `"error"` del backend) —
>   es el insumo directo de la matriz de riesgo de la semana 10.
>
> **Lo que quedó para la semana 2:** la rama `qa-learning` (el trabajo se hizo en
> `main` a pedido explícito) y el bloque de inglés.

**Búsqueda laboral (1 h):** abrí 10 ofertas de QA Jr. en Colombia y volcá en una hoja: stack, años, inglés, salario si aparece, herramientas. No te postules todavía. **Entregable:** top 3 requisitos repetidos.

**Inglés (15 min/día):** leé “Getting Started” de Playwright con traductor y anotá 5 palabras.

**Si te trabás:** no instales nada nuevo. Corré solo Vitest y leé `fecha.test.js`; con eso ya cumplís el 80 %.

---

### Semana 2 · 23–29 nov · Unitarios JS y diseño de casos

**Meta:** escribir tests unitarios útiles, no tests que solo repiten el código.

**Concepto (2 h):** AAA, determinismo, valores límite, particiones de equivalencia, cobertura de líneas vs ramas. ISTQB capítulo 4 (1 h).

**Práctica (11 h):**

1. Leé `frontend/src/fecha.js` y `frontend/src/fecha.test.js`.
2. Agregá 6 casos a `formatearTelefono` usando `it.each`: vacío, 9 dígitos, 10 dígitos, 12 con `+57`, `+52`, `+51`, con espacios.
3. Agregá casos límite a `sumarDias`: `2028-02-28` (año bisiesto), `2027-02-28`, cambio de año.
4. Agregá inválidos a `fechaHoraAUtc`: `''`, `'25:00'`, `'2026-02-30'`.
5. Rompé un valor esperado a propósito, corré el test y leé el error. Revertí.
6. ○ Cobertura: instalá `@vitest/coverage-v8` compatible con Vitest 5 y corré `npx vitest run --coverage`; mirá ramas, no solo líneas.

**Verificá:** `npx vitest run src/fecha.test.js` en verde.

**Entregable:**

- [ ] 3 tests nuevos (mínimo 8 casos) en `fecha.test.js`.
- [ ] Bitácora: “el caso que no se me había ocurrido y por qué importa”.

**Búsqueda laboral (1 h):** compará los requisitos de 3 ofertas con lo que Turnobot demuestra. Anotá 3 gaps reales (ej. SQL, Selenium, inglés). No cambies el CV todavía.

**Inglés:** 10 términos de testing (boundary, fixture, assertion, flaky, mock).

**Si te trabás:** elegí solo `formatearTelefono` y agregá 3 casos. Es suficiente.

---

### Semana 3 · 30 nov–6 dic · Unitarios Go y tabla de casos

**Meta:** leer y extender tests Go sin miedo.

**Concepto (2 h):** `testing`, `t.Run`, table-driven tests, `t.Helper`, `t.Skip` vs `t.Fatal`, `go vet`. ISTQB capítulo 2 (1 h).

**Práctica (11 h):**

1. Leé `backend/phone_test.go`, `backend/policy_test.go`, `backend/paginacion_test.go`.
2. Agregá 4 filas a `TestSanitizePhone`: `+57 300 123 4567`, 9 dígitos, letras, número con espacios.
3. Elegí una función pura de `policy.go` o `paginacion.go`, leela y escribí un test table-driven nuevo.
4. Corré `go test -run TestSanitizePhone -v`, después `go test ./...` y `go vet ./...`.
5. Explicá en la bitácora por qué los tests de integración se omiten y qué los haría correr.

**Verificá:** test nuevo en verde y `go vet` sin salida.

**Entregable:**

- [ ] 2 tests Go nuevos.
- [ ] Bitácora: diferencia entre unitario e integración en Turnobot.

**Búsqueda laboral (1 h):** actualizá el titular de LinkedIn y seguí 5 empresas que publican QA en Colombia. No postules aún.

**Inglés:** primera página de “Go testing” con traductor.

**Si te trabás:** copiá una fila existente de `TestSanitizePhone` y cambiá solo el número.

---

### Semana 4 · 7–13 dic · Integración con emulador

**Meta:** correr tests de handlers contra Firestore/Auth locales y entender el aislamiento.

**Concepto (2 h):** integración, fixtures/seed, aislamiento, transacciones, concurrencia, emulador. ISTQB capítulo 3 (1 h).

**Práctica (11 h):**

1. Levantá el emulador (ver §9).
2. Exportá las variables y **verificá con `echo`** que el host del emulador no esté vacío.
3. Corré `go test ./... -count=1 -v` y después `go test -run TestBookHappyPath -v` y `go test -run TestBookConcurrenteMismoSlot -v`.
4. Leé `seedTienda`, `postBook`, `slugUnico` en `handlers_test.go`; dibujá request → handler → Firestore → response.
5. Agregá 1 test: reserva sin `servicio_id` o con teléfono inválido → status y JSON esperados. Usá `postBook`.
6. ○ Corré `go test -race -run TestBookConcurrenteMismoSlot -v` y mirá el detector de carreras.

**Verificá:** test nuevo en verde; los de integración ya no se omiten.

**Entregable:**

- [ ] 1 test de integración nuevo.
- [ ] Diagrama de 5 líneas del flujo.
- [ ] Autoevaluación ISTQB (20 preguntas) y decisión: ¿examen en la semana 14 o después?

**Búsqueda laboral (1 h):** escribí en formato STAR la historia del bug #1 (ya resuelto): qué encontré, cómo lo reproduje y cómo lo arreglé.

**Inglés:** 10 términos de integración (seed, fixture, teardown, isolation).

**Si te trabás:** si el emulador no arranca en 60 min, aparcá la duda y quedate con los unitarios. No sacrifiques la semana.

---

### Semana 5 · 14–20 dic · API manual y contrato

**Meta:** entender el contrato HTTP antes de automatizarlo.

**Concepto (2 h):** métodos y status, auth bearer, idempotencia, contrato, entornos/variables. ISTQB capítulo 4 (1 h).

**Práctica (11 h):**

1. Levantá emulador + backend + seed (ver §9). **Verificá el host del emulador antes del seed.**
2. Obtené token con `tests/api/get-token.mjs`.
3. Importá la colección y el environment en Postman; corré Health, Datos del negocio, Slots y Crear reserva. Inspeccioná el JSON.
4. Agregá 3 requests con `pm.test`: `/existe` con slug inexistente → `exists:false`; `/slots` sin `servicio_id` → 400; cancelar ID inexistente → 404/400.
5. Exportá la colección actualizada al repo.

**Verificá:** los 3 requests nuevos pasan en Postman.

**Entregable:**

- [ ] 3 requests con aserciones.
- [ ] Tabla de status codes usados por Turnobot y qué significa cada uno.

**Búsqueda laboral (1 h):** adaptá el CV a 3 ofertas concretas, con las palabras que usan (sin inventar experiencia).

**Inglés:** lista de status HTTP en inglés.

**Si te trabás:** hacé solo GET `/existe` y un POST sin token (401).

---

### Semana 6 · 21–27 dic · Newman y CI de API (semana light)

**Meta:** ejecutar la suite de API desde consola y entender el job de CI. Es semana de fiestas: carga liviana.

**Concepto (2 h):** CLI runners, exit codes, reportes, variables de entorno y secretos en CI. ISTQB capítulo 5 (1 h).

**Práctica (8 h):**

1. Corré la colección con `npx newman` (ver §9) y leé el reporte.
2. Agregá 3 tests negativos: 401 sin token, 400 teléfono inválido, 409 doble reserva.
3. Leé el job `api` de `.github/workflows/qa.yml` y escribí en 10 líneas qué hace cada paso.
4. ○ Generá reporte JSON y mirá la estructura.

**Verificá:** suite Newman verde en local.

**Entregable:**

- [ ] Suite Newman verde.
- [ ] Explicación de 10 líneas del job de CI.

**Búsqueda laboral (1 h):** escribile a 2 personas que trabajen en QA en LinkedIn; preguntá una sola cosa concreta (“¿qué hace un junior en tu equipo en la primera semana?”).

**Inglés:** sintaxis básica de GitHub Actions.

**Si te trabás:** corré solo Health y Existe. Con eso ya entendés el runner.

---

### Semana 7 · 28 dic–3 ene · Bug reports, repaso y colchón

**Meta:** consolidar lo aprendido y aprender a reportar un bug como profesional.

**Concepto (2 h):** ciclo de vida del bug, severidad vs prioridad, reproducibilidad, evidencia, esperado vs actual. ISTQB capítulo 6 (1 h).

**Práctica (9 h):**

1. Escribí `docs/bugs/BUG-001.md` con el bug #1 (script inexistente, ya resuelto en `d434434`): pasos, esperado, actual, evidencia, severidad, prioridad. Sirve como caso real de bug encontrado y corregido.
2. Escribí `docs/bugs/BUG-002.md` con el riesgo de E2E (#2): archivos, por qué puede escribir en prod, impacto, propuesta.
3. ○ `BUG-003.md` con el desajuste de seed de `visual.spec.js` (#5).
4. Re-corré lo seguro (Vitest, Go unitarios, Newman) y actualizá la bitácora.
5. Autoevaluación 1–5 por capa. Si algo está en 1–2, es el tema de la semana 8 o 9.
6. Si venís atrasado, usá esta semana para emparejar: es el colchón del plan.

**Verificá:** los bug reports se entienden sin que vos estés presente.

**Entregable:**

- [ ] 2 bug reports.
- [ ] Autoevaluación por capa.
- [ ] Bitácora al día.

**Búsqueda laboral (1 h):** publicá en LinkedIn qué probaste y qué bug encontraste (sin exagerar).

**Inglés:** 10 términos de defectos (severity, priority, repro steps, triage).

**ISTQB:** si decidiste rendir, agendá el examen para después de la semana 14. Si no, seguí sin culpa.

---

### Semana 8 · 4–10 ene · Playwright básico y seguridad

**Meta:** escribir un E2E estable desde cero y blindar el entorno local.

**Concepto (2 h):** locators (`getByRole`, `getByPlaceholder`), auto-waiting, web-first assertions, trace viewer, aislamiento. Docs de Playwright (1 h).

**Práctica (11 h):**

1. **Guardia de seguridad:** revisá `frontend/e2e-tests/target.js`. Ya valida emulador vs GCP; probá correr sin variables y con variables mezcladas: debe fallar rápido, no escribir nada. Si encontrás un caso no cubierto, agregalo.
2. Levantá emulador + backend + frontend + seed.
3. Corré solo los specs 🟢 locales: `npm run test:e2e:local:safe` (o `E2E_TARGET=local npx playwright test e2e-tests/booking-pom.spec.js e2e-tests/horarios.spec.js`).
4. Leé `e2e-tests/pages/BookingPage.js` y explicá cada locator: ¿por qué texto, por qué placeholder, por qué role?
5. Escribí `e2e-tests/mi-primer.spec.js` desde cero: abrir `/shop/mi-negocio`, verificar servicio, seleccionar, verificar el siguiente paso. Sin `waitForTimeout`; usá role/placeholder.
6. Forzá un fallo (esperá un texto que no existe), abrí el trace con `npx playwright show-trace` y anotá qué viste.

**Verificá:** spec nuevo en verde; el trace muestra el fallo.

**Entregable:**

- [ ] Guardia de emulador commiteada.
- [ ] 1 spec propio.
- [ ] Trace de un fallo intencional.
- [ ] Bitácora: por qué no usar `waitForTimeout`.

**Búsqueda laboral (1 h):** clasificá 5 ofertas por herramienta (Playwright, Cypress, Selenium). Anotá cuál predomina y qué te falta.

**Inglés:** página de locators de Playwright, en inglés, con 10 términos.

**Si te trabás:** no corras `booking.spec.js`; quedate con `booking-pom.spec.js`, que es más simple.

---

### Semana 9 · 11–17 ene · Page Object Model y fixtures

**Meta:** dejar de duplicar selectores y separar “qué probás” de “cómo lo hacés”.

**Concepto (2 h):** POM, fixtures, builders, selectores estables, DRY vs DAMP, acoplamiento.

**Práctica (11 h):**

1. Ampliá `BookingPage` con métodos que falten (`seleccionarFecha`, `fillCliente`, `confirmar`, `mensajeExito`).
2. Refactorizá `booking.spec.js` para usarlo. El spec debe leerse como una historia de negocio.
3. Creá `e2e-tests/fixtures.js` con `test.extend` que entregue `BookingPage` y un teléfono único por test.
4. Eliminá selectores duplicados; corré el spec.
5. Medí líneas antes/después y anotá si quedó más legible.

**Verificá:** spec refactorizado en verde y sin selectores sueltos.

**Entregable:**

- [ ] `BookingPage` ampliado.
- [ ] Fixture funcionando.
- [ ] Nota de 5 líneas: qué ganaste y qué perdiste con POM.

**Búsqueda laboral (1 h):** actualizá el CV con “Playwright + POM + CI” solo si podés defenderlo en una entrevista.

**Inglés:** artículo de POM (con traductor) y 10 términos.

**Si te trabás:** refactorizá un solo test, no todo el archivo.

---

### Semana 10 · 18–24 ene · Flujos de negocio y riesgo

**Meta:** probar lo que le importa al negocio, no solo lo que es fácil.

**Concepto (2 h):** pruebas basadas en riesgo, camino crítico, independencia, serial vs paralelo, aislamiento de datos.

**Práctica (11 h):**

1. Leé `reglas-negocio.spec.js` y `multi-tenant.spec.js` **sin correrlos** (están 🔴/🟡). Mapeá cada test a una regla de negocio.
2. Agregá 2 E2E nuevos: reprogramar una cita (happy path) y cancelar en el límite de 24 h (o no-show de una cita pasada).
3. Datos únicos por test; corré `--repeat-each=2` para detectar dependencia de orden.
4. Corré `--workers=2` y explicá por qué `playwright.config.js` usa `workers:1`. Si hay colisión, documentala.
5. Armá una matriz de riesgo: funcionalidad × impacto × probabilidad.

**Verificá:** 2 tests en verde y `--repeat-each=2` estable.

**Entregable:**

- [ ] 2 tests E2E.
- [ ] Matriz de riesgo.
- [ ] Explicación de la colisión (o de por qué no hay).

**Búsqueda laboral (1 h):** postulate a 3 ofertas con carta corta y específica. Guardá el link y la fecha.

**Inglés:** “test isolation” en docs de Playwright.

**Si te trabás:** hacé solo reprogramar; es el flujo más valioso.

---

### Semana 11 · 25–31 ene · CI, reportes y flaky

**Meta:** que la suite corra sola y que no te mienta.

**Concepto (2 h):** pipeline, artifacts, retries, traces, Allure, cuarentena de flaky, determinismo.

**Práctica (11 h):**

1. Leé el job `e2e` de `.github/workflows/qa.yml` y explicá cada paso.
2. Verificá las dos guardias ya implementadas: `smoke-prod.spec.js` exige `SMOKE_PROD=1`; `horarios.spec.js` toma `API_BASE` de `target.js`. Si encontrás una combinación que escriba en GCP sin querer, agregá el `throw` que falta.
3. Corré 3 veces el subconjunto 🟢 local. Registrá duración, fallos y flakes.
4. Arreglá 1 flaky: reemplazá texto por role, agregá datos únicos o esperá el estado correcto.
5. Generá reporte HTML y Allure; abrí el test más lento.
6. Pusheá la rama y abrí un PR. Mirá el CI. El job E2E corre solo el subconjunto local con emulador; no necesita secretos.

**Verificá:** 3 corridas verdes seguidas del subconjunto seguro.

**Entregable:**

- [ ] 2 guardias de seguridad.
- [ ] Reporte de flaky (test, síntoma, causa, fix).
- [ ] PR con link al CI.

**Búsqueda laboral (1 h):** grabate 5 minutos explicando “cómo automatizo un flujo de reserva”. Miralo y corregí muletillas.

**Inglés:** leé un log de CI en inglés y traducí 5 líneas.

**Si te trabás:** no pelees con el CI; dejá evidencia local (reporte + video) y seguí.

---

### Semana 12 · 1–7 feb · Visual y accesibilidad

**Meta:** detectar cambios que un assert funcional no ve.

**Concepto (2 h):** regresión visual, snapshots, umbrales, WCAG básico, roles, contraste, axe.

**Práctica (10 h):**

1. Arreglá el seed de `visual.spec.js`: o agregás “Corte y Barba” a `e2e-tienda`, o cambiás el spec a “Consulta General”. Corré y actualizá snapshots **en la rama**, no en `main`.
2. Provocá un diff real con un test temporal que inyecte CSS (`page.addStyleTag`), mirá el reporte y revertí.
3. Instalá `@axe-core/playwright` (una sola dependencia) y corré accesibilidad en la página de reserva.
4. Reportá 3 hallazgos con severidad y si son falsos positivos.

**Verificá:** visual en verde y reporte a11y con 3 hallazgos.

**Entregable:**

- [ ] Seed o spec de visual corregido.
- [ ] Reporte a11y de 1 página.
- [ ] Nota: qué no puede detectar un test visual.

**Búsqueda laboral (1 h):** actualizá el README del portfolio con capturas y links a reportes.

**Inglés:** WCAG quick reference, 10 términos.

**Si te trabás:** hacé solo el fix del seed y mirá un diff de snapshot. La accesibilidad puede esperar.

---

### Semana 13 · 8–14 feb · Performance y seguridad

**Meta:** entender los no funcionales sin volverte experto.

**Concepto (2 h):** carga vs estrés vs pico, percentiles p95, umbrales, línea base; OWASP básico, alcance y autorización.

**Práctica (10 h):**

1. Instalá k6 (una herramienta nueva, como dice la regla).
2. Corré `tests/perf/load.js` contra local; registrá p95 y error rate. Subí VUs 10 → 30 → 50 con cuidado.
3. Escribí un reporte de 1 página: hipótesis de cuello de botella (backend, emulador, frontend) y evidencia.
4. Leé `firestore.rules` y escribí 5 casos de control de acceso. Corré 2 con Postman/API: lectura sin token y escritura sin dueño.
5. ○ ZAP pasivo **solo contra local**. Nunca contra prod.

**Verificá:** salida de k6 con p95 y 2 casos de acceso.

**Entregable:**

- [ ] Reporte de performance de 1 página.
- [ ] Checklist de seguridad con 5 casos.
- [ ] Nota: qué NO probaste y por qué.

**Búsqueda laboral (1 h):** 5 postulaciones más y seguimiento de las anteriores.

**Inglés:** primeros 2 capítulos de docs de k6.

**Si te trabás:** saltá k6 y hacé solo el checklist de acceso. Es opcional.

---

### Semana 14 · 15–21 feb · Portfolio, entrevistas y cierre

**Meta:** convertir 3 meses de práctica en evidencia que se pueda mostrar.

**Concepto (2 h):** STAR, estrategia de prueba, tradeoffs, retrospectiva.

**Práctica (11 h):**

1. Escribí `docs/PORTFOLIO_QA.md`: resumen, pirámide, herramientas, 5 tests clave, 3 bugs, link al CI, cobertura, qué aprendiste, próximos 30 días.
2. Prepará 5 historias STAR: bug encontrado, flaky arreglado, diseño de casos, fallo de CI, conflicto de prioridad.
3. Hacé 2 simulacros de 45 min (uno con IA o colega): 15 min teoría + 30 min escribir un test en vivo.
4. Retrospectiva: qué mantener, qué soltar, qué estudiar en los próximos 30 días.
5. Postulate a 10 ofertas (3 h de la semana).

**Verificá:** el portfolio se entiende en 5 minutos y tiene links, no adjetivos.

**Entregable:**

- [ ] `docs/PORTFOLIO_QA.md`.
- [ ] 5 historias STAR.
- [ ] 2 simulacros.
- [ ] 10 postulaciones registradas.
- [ ] Retrospectiva y plan de 30 días.

**Búsqueda laboral (3 h):** postulaciones + seguimiento + 2 mensajes a reclutadores.

**Inglés:** hacé el simulacro en inglés 15 min, si te animás.

**Si te trabás:** el portfolio mínimo es una página con 3 links: repo, CI y un bug report.

---

## 7. Checklist final: ¿estoy listo para postularme?

- [ ] Escribí 15–20 tests propios (unitarios, API y E2E).
- [ ] Tengo 3 bug reports con pasos y evidencia.
- [ ] Hay un pipeline en verde (o un subconjunto seguro con evidencia).
- [ ] Puedo explicar: pirámide, AAA, POM, fixture, flaky, cobertura, 200/201/400/401/404/409.
- [ ] Puedo escribir un test en vivo en 30 min.
- [ ] Mi CV y LinkedIn tienen evidencia, no adjetivos.
- [ ] Envié 10 postulaciones y hice 2 simulacros.
- [ ] Sé pedir ayuda y decir “esto no lo sé”.

**No necesitás para el primer empleo:** 80 % de cobertura, ISTQB rendido, Selenium, inglés fluido. Suma, pero no bloquea.

---

## 8. Seguimiento semanal (plantilla para `docs/BITACORA.md`)

```markdown
# Bitácora QA

## Semana N — [fecha]
- Entregable de la semana:
- ¿Está hecho? sí / no
- Qué aprendí (3 bullets):
- Qué me trabó:
- Dudas aparcadas (para no perseguirlas hoy):
- Evidencia (link a commit, test, reporte):
- Próximo paso (uno solo):
```

**Preguntas del domingo (10 min):**

1. ¿Qué construí esta semana?
2. ¿Qué puedo explicar sin mirar?
3. ¿Qué no entendí y estoy evitando?
4. ¿Cuál es el único próximo paso?

**Plantilla de bug report:**

```markdown
# BUG-00X — Título corto y específico
- Severidad: crítica / alta / media / baja
- Prioridad: alta / media / baja
- Entorno: local con emulador / CI / prod
- Pasos: 1. … 2. … 3. …
- Esperado: …
- Actual: …
- Evidencia: comando, log, captura o trace
- Impacto: a quién afecta y cuánto
- Nota: ¿es reproducible siempre o a veces?
```

---

## 9. Entorno local: comandos base

### 9.1. Emulador (terminal 1)

```bash
cd /home/plurall/source/turnobot
npx --yes firebase-tools emulators:start \
  --config firebase.emu.json \
  --project demo-test \
  --only firestore,auth
```

La primera vez descarga el emulador. Requiere Java (ya lo tenés).

### 9.2. Variables (terminal 2)

```bash
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8090
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9098
export GCP_PROJECT_ID=demo-test   # el mismo --project con el que arranca el emulador
export EMPLOYEE_TOKEN_KEY=dev-employee-token-key-minimum-32-chars!!
export CRON_SECRET=dev-cron
export FRONTEND_URL=http://localhost:5173
```

**Verificá siempre antes de un test de integración o E2E:**

```bash
echo "$FIRESTORE_EMULATOR_HOST"   # debe decir 127.0.0.1:8090
```

Si está vacío, **no corras E2E ni seed**.

### 9.3. Backend

```bash
cd backend
go run .    # :8080
```

### 9.4. Seed local (solo con emulador)

```bash
cd backend
# OJO: el nombre de la variable asusta, pero con FIRESTORE_EMULATOR_HOST apunta al emulador.
# Si el host está vacío, NO lo corras.
SEED_ALLOW_PROD=1 go run seed.go
```

### 9.5. Tests Go

```bash
cd backend
go test ./... -count=1
go test -run TestBookHappyPath -v
go vet ./...
```

### 9.6. API con Newman

```bash
cd tests/api
node get-token.mjs > /tmp/token.txt

cd /home/plurall/source/turnobot
npx --yes newman run tests/api/turnobot.postman_collection.json \
  -e tests/api/turnobot.postman_environment.json \
  --env-var "idToken=$(cat /tmp/token.txt)" \
  --env-var "baseUrl=http://localhost:8080"
```

### 9.7. Playwright (solo subconjunto seguro)

```bash
cd frontend
export E2E_TARGET=local
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8090
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9098
export PLAYWRIGHT_BASE_URL=http://localhost:5173

npm run test:e2e:local -- e2e-tests/booking-pom.spec.js
npm run test:e2e:local -- e2e-tests/horarios.spec.js --trace on
npx playwright show-trace test-results/.../trace.zip
```

Para el flujo completo con login, usá GCP y la suite segura:

```bash
cd frontend
npm run test:e2e:gcp:safe
```

**No corras la suite GCP completa** hasta la semana 11 y solo con ADC + guardias puestas.

---

## 10. Seguridad y ética (leer antes de tocar Firestore)

- **Nunca** corras `smoke-prod.spec.js` sin `SMOKE_PROD=1`; `barberia-vip-prod.mjs` y `settings-prod.mjs` son scripts de producción, no tests.
- `cleanup-staging.mjs` es seguro por defecto: es dry-run y solo borra prefijos `e2e`. Revisá la lista antes de agregar `--yes`.
- **Nunca** ejecutes `backend/seed.go` sin `FIRESTORE_EMULATOR_HOST`. Ese script usa `Set` y sobrescribe. Para GCP, la suite usa `garantizarNegocioDemo()` con `merge`; si insistís con `seed.go`, hacelo con `SEED_ALLOW_PROD=1` y ADC, sabiendo que pisa `mi-negocio`.
- **Nunca** subas claves, tokens ni archivos `.env` al repo.
- Usá datos ficticios: nombres y teléfonos inventados.
- Si un test necesita credenciales reales, no es un test: es una integración manual. Aparcala.
- Si dudás, preguntá antes. Un test que borra datos de un cliente real no se “arregla” con un commit.

---

## 11. Recursos (español primero, una sola fuente por tema)

| Tema | Recurso | Nota |
|------|---------|------|
| Fundamentos | ISTQB CTFL syllabus en español (sitio oficial de ISTQB) | Leé capítulos 1–6; no pagués nada hasta decidir |
| Pirámide y guía local | `docs/QA_GUIDE.md` | Tu mapa del repo |
| Playwright | `playwright.dev` (inglés; usá traducción del navegador) | Locators, assertions, POM, trace |
| Testing Library | `testing-library.com` | Para Vitest/React |
| Go testing | `go.dev/doc/tutorial/add-a-test` | Table-driven |
| Postman/Newman | `learning.postman.com` | Requests, tests, CLI |
| k6 | `k6.io/docs` | Semana 13 |
| Accesibilidad | WCAG quick reference (versión en español) | Semana 12 |
| Seguridad | OWASP Top 10 en español | Semana 13 |

**Regla:** si un tema tiene dos fuentes, elegí una y descartá la otra hasta terminarlo.

---

## 12. Cómo usar la IA sin depender de ella

- Pedí **explicaciones**, no soluciones: “explicame este test línea por línea”.
- Pedí **preguntas**: “hacéme 5 preguntas de este tema y corregí mis respuestas”.
- Pedí **revisión**: “¿qué casos me faltan y cuáles son flaky?”.
- Después de cada respuesta, **escribí tu versión sin mirar**.
- No pegues código que no puedas explicar en una entrevista.
- Usala para generar datos de prueba y para simular entrevistas, no para decidir qué probar.

---

## 13. Plan B: si te atrasás o se te complica

| Situación | Qué hacer |
|-----------|-----------|
| 1 semana atrasado | Usá la semana 7 o 14 como colchón; no saltees API/E2E/CI. |
| 2 semanas atrasado | Recortá semanas 12 y 13 (no funcionales). |
| Solo 10 h/semana | Hacé solo ⭐ y estirá el plan a 18 semanas. |
| Emulador no funciona | Quedate en unitarios + API con backend local; E2E cuando lo resuelvas. |
| Te abruma el repo | Trabajá solo con `frontend/src/fecha.test.js` y `e2e-tests/booking-pom.spec.js`. |
| Conseguís entrevista antes | Priorizá portfolio, STAR y los 10 conceptos; el resto sigue después. |

**Núcleo mínimo si todo se complica (8 semanas):** 1, 2, 4, 5, 6, 8, 9, 11 y 14.

---

## 14. Si el mercado pide Selenium + Java

No lo estudies en paralelo. Los conceptos son los mismos: locators, waits, POM, fixtures, CI. Después de la semana 14, hacé un puente de 5 días:

1. Día 1: instalar Selenium + JUnit (Java ya está).
2. Día 2: repetir el flujo de reserva con locators.
3. Día 3: waits explícitos y POM.
4. Día 4: datos de prueba y assertions.
5. Día 5: correr en CI y escribir la comparación Playwright vs Selenium.

En una entrevista, decir “aprendí los conceptos en Playwright y los transferí a Selenium en una semana” es más fuerte que decir “hice un curso de 40 horas de Selenium”.

---

## 15. Primer día: 2 horas exactas

1. **30 min:** leé §0, §2 y §3 de este plan.
2. **30 min:** `cd frontend && npx vitest run` → mirá los 43 tests.
3. **30 min:** abrí `src/fecha.test.js` y marcá AAA en un test; escribí 3 líneas en `docs/BITACORA.md`.
4. **30 min:** corré `cd frontend && npm run test` (43 tests) y mirá `git show d434434 -- frontend/package.json` para entender el bug #1 que ya corregimos.

> Si hacés solo esto, ya empezaste. El plan no se falla por un día malo; se falla por no volver al día siguiente.

---

*Plan vivo: si algo no funciona, se cambia. La versión que importa es la que podés sostener.*
