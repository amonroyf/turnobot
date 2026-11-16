# Cómo ver las pruebas en el navegador (y aprender con ellas)

> Guía práctica del 16 nov 2026. Todo lo de acá **fue ejecutado y verificado**
> en esta máquina, no es teoría.
>
> Hay **5 herramientas** y cada una sirve para algo distinto. La clave es
> saber cuál usar según lo que quieras aprender.

---

## El mapa rápido

| Quiero… | Herramienta | Comando |
|----------|-------------|---------|
| **Ver el test corriendo en vivo**, paso a paso, poder parar y probar | Playwright **UI mode** | `npm run test:e2e:ui` |
| **Depurar un test**, avanzar paso a paso, ver el DOM | Playwright **Inspector** | `npm run test:e2e:debug` |
| **Ver el navegador real** working (headed) | Playwright headed | `npm run test:e2e:headed` |
| **Revisar una corrida terminada**, con video, capturas y errores | Playwright **HTML report** | `npm run test:e2e:report` |
| **Ver qué escribió cada handler en Firestore** | **Visor del harness** (nuevo) | `npm run qa:harness` |

Y el que **no es navegador pero es el mejor para aprender**: el **trace viewer**
(ver §3), que te deja rebobinar la ejecución como un video con el DOM
congelado en cada paso.

---

## 0. Setup: levantar el entorno (una sola vez por sesión)

El E2E local necesita **tres cosas** arriba: emulador, backend y frontend.

```bash
# Terminal 1 — emulador Firestore + Auth
cd /home/plurall/source/turnobot
npx --yes firebase-tools emulators:start \
  --config firebase.emu.json --project demo-test --only firestore,auth

# Terminal 2 — backend Go (el frontend lo levanta Playwright solo)
cd backend
export GCP_PROJECT_ID=demo-test
export EMPLOYEE_TOKEN_KEY=dev-employee-token-key-minimum-32-chars!!
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8090
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9098
go run .

# Terminal 3 — variables de Playwright
cd frontend
export E2E_TARGET=local
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8090
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9098
export PLAYWRIGHT_BASE_URL=http://localhost:5173
export API_BASE=http://localhost:8080
```

⚠️ **El `--project demo-test` tiene que coincidir con el `GCP_PROJECT_ID` del
backend.** Si no, el token de Auth llega con un `aud` distinto y todo falla con
401 (es el BUG-003).

💡 `npm run test:e2e:ui` **levanta Vite solo** (el `webServer` del
`playwright.config.js`), así que no necesitás la Terminal 3 para el frontend.

---

## 1. Playwright UI mode — el mejor para aprender

```bash
cd frontend
npm run test:e2e:ui
```

Se abre `http://localhost:9323` con:

- **La lista de tests** a la izquierda, con el último resultado.
- **El modo "Pick locator"**: activás el grabador de la esquina y hacés clic en
  un elemento del navegador; el visor te dice qué locator usar
  (`getByRole('button', { name: 'Reservar' })`). **Es la mejor forma de
  aprender locators** — mucho más rápido que leer la documentación.
- **Watch mode**: guardás el spec y los tests se re-corren solos.
- **Steps**: cada `expect` aparece como un paso con su resultado.

**Ejercicio para vos:** abrí `booking-pom.spec.js`, activá "Pick locator",
hacé clic en el botón de reservar y anotá el locator que te da. Después leé
`pages/BookingPage.js` y compará: ¿coincide con el del POM? Si no, ¿por qué?

### Limitación

El UI mode **no funciona bien con `--workers: 1` + `fullyParallel: true`** y
tampoco es ideal para ver video. Para ver el video, usá headed o el reporte.

---

## 2. Playwright Inspector — depurar paso a paso

```bash
cd frontend
npm run test:e2e:debug
```

Abre el navegador **y** un panel lateral con:

- Los pasos del test, uno por uno, con botón **"Resume"/"Step over"/"Step into"**.
- El **snapshot del DOM** de cada paso (con el selector resaltado).
- Las **variables locales** en cada momento.
- Los **requests de red** y la **consola**.

Es la herramienta para responder "¿por qué falló?". When un test falla y no
sabés por qué, corrélo con `--debug` y caminá los pasos.

**Ejercicio:** escribí un test que espere un texto que no existe, corrélo con
`--debug`, y avanzá paso a paso hasta ver dónde se rompe. Es el ítem 5 del plan
de la semana 8.

---

## 3. Trace viewer — rebobinar la ejecución ⭐

**Esta es la herramienta más subestimada de Playwright** y la que más te va a
servir para aprender.

```bash
cd frontend
# 1. Corré los tests con traza activada
npx playwright test e2e-tests/booking-pom.spec.js --trace on

# 2. Abrí el visor
npx playwright show-trace test-results/<carpeta-del-test>/trace.zip
```

Dentro del visor tenés **4 pestañas**:

| Pestaña | Qué te muestra |
|---------|----------------|
| **Actions** | La línea de tiempo de cada acción: `Frame.goto`, `Frame.expect`, con el **selector exacto** que se usó |
| **Snapshot** | El **DOM congelado** en ese instante. Podés ver el HTML y se resalta el nodo que hizo match |
| **Network** | Cada request: URL, método, status, payload, respuesta |
| **Console** | Los `console.log` del navegador |

Lo que hace especial al trace viewer es el **"step back"**: volvés a un paso
anterior y el DOM se reconstruye **exactamente** como estaba. Podés inspeccionar
por qué un locator falló.

**Ejercicio (este es el corazón del aprendizaje):**
1. Corré `booking-pom.spec.js --trace on`.
2. Abrí el trace.
3. En la pestaña **Actions**, mirá el selector que se usó:
   `internal:text=/Consulta General/i >> nth=0`.
4. En **Snapshot**, buscá ese nodo y mirá el HTML real de la página.
5. Ahora entendés de verdad **qué está matcheando** el locator.

**Verifiqué el contenido de una traza real del repo:**

```
trace.zip
├── 1-trace.trace        ← las acciones (con selector y timestamps)
├── 1-trace.network      ← las requests
├── screencast/*.jpeg    ← los frames del video (timeline)
├── attachments/         ← capturas
└── test.trace           ← metadatos del test
```

---

## 4. HTML report — la corrida terminada

```bash
cd frontend
npm run test:e2e:report       # abre el reporte en el navegador
```

También podés abrir el archivo directo (es autocontenido):

```
frontend/playwright-report/index.html
```

Qué tiene:
- Filtros **All / Passed / Failed / Flaky / Skipped**.
- Botón de **"Flaky"**: los tests que pasaron después de un reintento. **Es la
  lista de tus tests frágiles** — la semana 11 del plan.
- Por cada test: video (icono de cámara), capturas, error y traza.
- La sección **Metadata**: target, project ID y base URL de la corrida.

⚠️ **Gotcha (la descubrí hoy):** si corrés Playwright con `--reporter=list`
o `--reporter=html`, **sobrescribís los reporters del `playwright.config.js`**
y el HTML **no se regenera**. Peor: un `--list` previo deja el reporte
**vacío** ("No tests found"). Para tener el reporte completo, corré sin
`--reporter`.

### Allure (alternativa, más bonita)

El config ya genera resultados de Allure:

```bash
cd frontend
npx --yes allure serve allure-results      # dashboard en el navegador
```

No viene instalado (se baja con `npx`), y su dashboard es más lindo pero **no
tiene el "rebobinado" del trace viewer**. Para aprender, el trace viewer gana.

---

## 5. ⭐ El visor del harness — lo nuevo de hoy

Los tests de Go generan reportes JSON con el **delta de Firestore** de cada
llamada al handler. Antes no había forma cómoda de mirarlos. Ahora sí:

```bash
cd frontend
npm run qa:harness
```

Abre `http://localhost:4173` con:

- **Lista a la izquierda**: cada llamada al handler, con su status HTTP, la
  duración y cuántos documentos tocó.
- **Filtros**: por nombre/URL, por status HTTP, y por **"con cambios en BD" /
  "sin cambios en BD"** (este último es el filtro más útil: te dice qué
  handlers rechazaron sin escribir).
- **4 pestañas en el detalle**:
  - **Request / Response** — lo que se mandó y lo que volvió.
  - **Delta de Firestore** — qué docs se crearon, modificaron o borraron, con
    el JSON completo del antes y del después.
  - **Logs** — lo que el handler imprimió por consola.
  - **JSON crudo** — el reporte entero.

### Cómo leerlo (esto es lo importante)

| Lo que ves | Lo que significa |
|------------|-------------------|
| `201` + `reservas/…: added` + `clientes/…: added` | El handler escribió la reserva **y** el cliente. Correcto. |
| `400` + **delta vacío** | El handler rechazó y **no escribió nada**. Correcto. |
| `201` + **delta vacío** | ⚠️ **Sospechoso.** Un 201 que no escribió nada. Acá hay un bug o un honeypot. |
| `4xx` + **delta con docs** | ⚠️ **Candidato a bug**, NO prueba. Hay que verificar (ver la nota de concurrencia abajo). |

### ⚠️ La trampa de los tests concurrentes (la descubrí hoy)

El visor y el harness marcan 7 casos de `409` **con** delta en
`TestBookConcurrenteMismoSlot`. **No son bugs.** Lo verifiqué comparando los IDs:

```
TestBookConcurrenteMismoSlot.json    http=201  reserva=['lEsPNebOh0onvI8iiFxw']
TestBookConcurrenteMismoSlot_2.json  http=409  reserva=['lEsPNebOh0onvI8iiFxw']   ← misma
TestBookConcurrenteMismoSlot_3.json  http=409  reserva=['lEsPNebOh0onvI8iiFxw']   ← misma
...
```

**Los 8 reportes muestran la MISMA reserva: la del ganador.** Los handlers que
devolvieron 409 no escribieron nada.

**Por qué:** el test lanza 8 goroutines. Cada una toma el snapshot "antes" al
mismo tiempo, **antes** de que ninguna ejecute el handler. Cuando la que gana
escribe, todas las demás ven ese cambio en su snapshot "después".

> El delta mide **"qué cambió en la base durante mi ventana"**, no
> **"qué escribió mi llamada"**. Solo coinciden cuando el test es secuencial.

**Cómo se verifica un candidato a bug:**

1. Mirá el status HTTP y el delta.
2. Buscá **otros reportes del mismo test** que tengan los mismos IDs de documento.
3. Si el `409` y el `201` muestran la **misma** reserva → el 409 no escribió nada
   → falso positivo.
4. Si el `409` muestra una reserva **distinta** a la del `201` → ahí sí escribió →
   **bug de producción**.

El visor te avisa con una banda amarilla cuando un test tiene varias llamadas,
para que no pierdas tiempo persiguiendo un falso positivo.

### Ejercicio (el mejor del repo)

1. `npm run qa:harness`
2. Filtrá por **"sin cambios en BD"**.
3. Mirá los que tienen `201`.
4. ¿Todos son honeypots a propósito, o alguno es un bug?

**Respuesta:** `TestBookHoneypotFingeExito` es a propósito (detecta bots:
responde 201 sin escribir). Pero si aparece otro 201 sin delta que no sea
honeypot, **es un bug de producción** y ya tenés tu evidencia.

### Ejercicio 2 · el de pensar como QA (el que más rinde)

1. Filtrá por **"con cambios en BD"**.
2. Buscá los `4xx` **con** delta → salían 7 candidatos.
3. **No los reportes como bugs.** Verificá comparando los IDs entre reportes.
4. Anotá en la bitácora: *"el harness marcó 7 candidatos, los 7 eran falsos
   positivos por concurrencia; la técnica para descartarlos es comparar IDs
   entre llamadas del mismo test"*.

Eso es **exactamente** el trabajo de un QA: la herramienta te da un candidato,
vos tenés que descartar los falsos positivos con evidencia. Reportar 7 bugs
falsos es peor que no reportar nada.

---

## 6. Ejercicios de aprendizaje (del más fácil al más difícil)

| # | Ejercicio | Herramienta | Qué aprendés |
|---|-----------|-------------|--------------|
| 1 | Abrí un test, activá "Pick locator" y clickeá 3 elementos | UI mode | Cómo pensar un locator |
| 2 | Escribí un test que espere un texto imposible | UI mode + trace | Cómo se ve un fallo |
| 3 | Corré un test con `--debug` y avanzá paso a paso | Inspector | Depuración real |
| 4 | Abrí una traza y buscá el DOM de un paso | Trace viewer | Qué matchea un locator |
| 5 | Corré los tests Go y filtrá el visor por "sin cambios en BD" | Visor harness | Evidencia de BD |
| 6 | Buscá un `4xx` **con** delta y **verificá** si es bug | Visor harness | Descartar falsos positivos |
| 7 | Cambiá un `expect` a propósito y corré | Los 3 | Leer un error |

El #6 es el que más se parece a un trabajo real de QA. Y tiene trampa: salen's
7 candidatos que **no** son bugs (ver §5). El ejercicio no es "reportá los
candidatos" sino **descartarlos con evidencia**.

---

## 7. Gotchas que descubrí hoy (guardá esto)

1. **`--list` NO ejecuta el `globalSetup`** → no valida la guardia de entorno
   y **deja el reporte HTML vacío** ("No tests found"). Para probar la guardia,
   ejecutá un spec de verdad.
2. **`--reporter=list` sobrescribe los reporters del config** → el HTML no se
   regenera.
3. **El project ID tiene que coincidir** en emulador, backend y tests
   (BUG-003). Si no: 401 `invalid 'aud'`.
4. **El emulador sin Auth = tests omitidos en silencio.** `go test` sale con
   código 0 y no corrió casi nada.Siempre mirá `go test -v | grep SKIP`.
5. **El visor del harness muestra el status de la RESPUESTA HTTP, no del
   test.** Un `fail` ahí significa "el handler respondió 4xx/5xx", que en un
   caso negativo es lo **esperado**, no un fallo.
6. **El visor corre en `127.0.0.1:4173`** — no lo expongas a la red: los
   reportes contienen datos de clientes de prueba (teléfonos, emails).

---

## 8. Cheatsheet

```bash
# ── E2E ───────────────────────────────────────────────
cd frontend
npm run test:e2e:ui                      # UI mode (aprender)
npm run test:e2e:debug                   # inspector (depurar)
npm run test:e2e:headed                  # navegador visible
npm run test:e2e:report                  # reporte HTML
npx playwright test <spec> --trace on    # generar traza
npx playwright show-trace <ruta>/trace.zip

# ── Harness Go ────────────────────────────────────────
cd backend
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8090
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9098
export GCP_PROJECT_ID=demo-test
go test ./... -count=1                  # 104 tests + 89 reportes JSON
cd ../frontend && npm run qa:harness     # visor en el navegador
```
