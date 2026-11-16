# Notas de lectura de código — Semana 1

> Lectura del código fuente de Turnobot hecha en la sesión del 16 nov 2026.
> No es documentación de referencia: son las **reglas de negocio que extraje
> del código** y que después se convierten en casos de prueba.

---

## 1. El mapa del backend

`backend/main.go` — **204 KB, 114 funciones, 26 handlers**. Todo en un archivo.

| Dominio | Handlers |
|---------|----------|
| Reserva | `bookHandler`, `cancelCitaHandler`, `cancelSesionHandler`, `listCitasHandler`, `getSlotsHandler`, `getPrimerHuecoHandler` |
| Catálogo | `createRecursoHandler`, `updateServicioHandler`, `deleteServicioHandler`, `deleteEmpleadoHandler`, `deleteRecursoHandler` |
| Empleado | `employeeLoginHandler`, `employeePinHandler`, `setEmployeePinHandler`, `employeeHorarioHandler`, `employeeCitasHandler`, `employeePagoHandler` |
| Push | `employeeRegisterPushTokenHandler`, `employeeUnregisterPushTokenHandler` |
| Negocio | `getNegocioHandler`, `invalidateCacheHandler`, `deleteNegocioHandler` |
| Google Calendar | `googleLoginHandler`, `googleCallbackHandler`, `employeeCalendarStatusHandler` |

Los archivosXYZR se separaron por responsabilidad:
`main.go` (reservas) · `push.go` · `reminders.go` · `noshow.go` · `reschedule.go` ·
`undo.go` · `cache.go` · `middleware.go`.

### Las 3 columnas de Firestore

```
negocios/{slug}                    → el tenant
  ├── servicios/{id}               → catálogo
  ├── empleados/{id}               → profesionales (tienen horario y servicios_ids[])
  └── recursos/{id}                → espacios/clases (capacidad, instructor_id)
reservas/{id}                      → raíz, con negocio_id
clientes/{id}                      → raíz, con negocio_id
```

**Consecuencia para los tests:** `reservas` y `clientes` son de raíz y se filtran
por `negocio_id`; los otros son subcolecciones y se acotan por el doc padre.
Un snapshot que solo mire la raíz se pierde la mitad del modelo.

---

## 2. Las 38 reglas de negocio (extrídas de los códigos de error)

Cada `"error": "..."` del backend es una regla que alguien decidió. Extraje las
38 y las clasifiqué. **La columna de la derecha es la que me interesa**: cuáles
no tienen ningún test que las verifique.

| Regla (`error`) | HTTP | Cubierta |
|-----------------|------|----------|
| `slot_taken` | 409 | ✅ |
| `servicio_no_encontrado` | 400 | ✅ |
| `servicio_no_ofrecido` | 400 | ✅ |
| `invalid_phone` | 400 | ✅ |
| `muy_pronto` | 400 | ✅ |
| `notas_muy_largas` | 400 | ✅ |
| `instructor_con_choque` | 409 | ✅ |
| `sin_cupo` | 409 | ✅ |
| `horario_invalido` | 400 | ✅ |
| `hora_invalida` / `fecha_invalida` | 400 | ✅ |
| `hora_invalida` / `fecha_invalida` | 400 | ✅ |
| **`business_suspended`** | 403 | ❌ |
| **`cita_cerrada`** | 409 | ❌ |
| **`cita_pasada`** | 409 | ❌ |
| **`fecha_pasada`** | 400 | ❌ |
| **`max_per_day`** | 429 | ❌ |
| **`missing_fields`** | 400 | ❌ |
| **`too_late_to_cancel`** | 409 | ❌ |
| **`unauthorized`** | 403 | ❌ |
| **`token_requerido`** / **`token_invalido`** | 401 | ❌ |
| **`sin_profesional`** | 400 | ❌ |
| **`solo_un_cupo`** / **`sin_acompanantes`** | 400 | ❌ |
| **`lugar_duplicado`** | 409 | ❌ |
| **`recurso_no_encontrado`** | 400 | ❌ |
| **`solo_propia_agenda`** | 403 | ❌ |
| **`no_hay_hueco`** | 404 | ❌ |
| **`cursor_invalido`** | 400 | ❌ |
| **`rate_limited`** / **`phone_rate_limited`** | 429 | ❌ |
| **`servicio_con_citas`** / **`recurso_con_citas`** / **`empleado_con_citas`** | 409 | ❌ |
| **`instructor_ocupado`** | 409 | ❌ |
| **`sesion_pasada`** | 409 | ❌ |
| **`login_requerido`** | 401 | ❌ |
| **`invalid_name`** | 400 | ❌ |

### Las 4 que más me preocupan (las que se van a la matriz de riesgo)

1. **`max_per_day` (429)** — el README dice "máximo 3 citas por teléfono por día
   natural". Es un límite anti-abuso que **cobra dinero al negocio si falla**
   (un cliente legítimo bloqueado). Y es **por teléfono**: dos personas
   distintas en la misma casa comparten el número. **No hay test.**

2. **`too_late_to_cancel` (409)** — la ventana de 24 h. El README dice
   "configurable". Un cliente que cancela 25 h antes recibe un 409 y no puede
   liberar el slot. **No hay test** y hay 2 fuentes de configuración
   (`cancel_window_hours` del negocio + el default).

3. **`business_suspended` (403)** — el super admin puede suspender un negocio.
   El handler lo chequea **antes** de cualquier validación. Si suspendés un
   negocio, ¿el cliente recibe un mensaje útil? ¿el webhook de push también se
   corta? **No hay test.**

4. **`solo_propia_agenda` (403)** — un empleado no puede ver/agendar en la
   agenda de otro. **Es una regla de aislamiento entre empleados del mismo
   negocio.** No es multi-tenant (eso sí está cubierto) sino intra-tenant.
   **No hay test.**

### Patrón que veo en el código

`bookHandler` valida en **tres capas** y devuelve el mismo error con mensajes
distintos:

```
capa 1 (pre-transacción)  → mensaje para el usuario final
capa 2 (dentro de la tx)  → mensaje técnico
capa 3 (post-transacción) → mensaje para el usuario final
```

Ejemplo real (`slot_taken`): si el conflicto lo detecta la transacción, el
cliente recibe un mensaje de "ese horario ya no está" aunque el conflicto real
haya sido el *cupo* del recurso. **El código de error no distingue el motivo.**
Eso es una debilidad de diseño que se puede testear: dos causas distintas,
mismo `error`, mensajes distintos.

---

## 3. El harness (`turnobot-test-learn/sandbox/`) — lectura a fondo

Es la pieza más interesante del repo y **estaba a medio usar**.

```
snapshot.go  → captura el estado de N colecciones (antes y después)
delta.go     → diff: added / modified / removed
recorder.go  → Intercept(): envuelve un handler HTTP y junta todo en un TestRun
```

### Cómo funciona `Intercept()`

1. Lee el body del request (y lo restaura, para que el handler lo pueda leer).
2. `Snapshot()` **antes**.
3. Redirige `os.Stdout`/`os.Stderr` y el logger a un pipe → captura los logs.
4. Ejecuta el handler con un `httptest.ResponseRecorder`.
5. `Snapshot()` **después**.
6. `Delta(before, after)` → el diff.
7. Arma un `TestRun` con request, response, DB antes/después, delta y logs.

### Lo que le faltaba (y arreglé)

| Falta | Consecuencia |
|-------|--------------|
| `equalDocs` usaba `==` | **panic** con arrays → el harness crashea justo cuando hay algo que reportar (BUG-002) |
| `Snapshot` solo leía raíz | `empleados`/`servicios`/`recursos` fuera del reporte |
| No escribía nada en disco | El `TestRun` se perdía (el caller tenía que hacer algo con él) |
| Un test con N llamadas sobrescribía su reporte | Solo quedaba la última |
| `log.SetOutput(oldStderr)` | Pisaba el destino previo del logger |
| Reportes al TMS por `localhost:8080` | Colisión con el backend: 404 silencioso |

### El diseño que me gustó

`TestRun` es un **struct serializable**, no un tipo opaco. Eso permite que el
mismo reporte vaya a tres destinos sin transformar nada: archivo local (JSON),
TMS (HTTP POST) y consola. Es una decisión de diseño pequeña y muy buena:
**la evidencia se produce una vez y se reparte.**

### El diseño que me preocupó

`Intercept` **muta variables globales** (`os.Stdout`, `os.Stderr`, el logger).
Hoy no hay ningún `t.Parallel()` en el paquete, así que no explota. Pero el día
que alguien agregue un test paralelo, el harness va a capturar los logs de
otro test y a mezclar los deltas. **Es una bomba de tiempo.** Debería inyectar
un `io.Writer` en vez de reasignar `os.Stdout`.

---

## 4. El frontend: `fecha.js` — un buen ejemplo de lógica testeable

`frontend/src/fecha.js` (193 líneas) tiene **7 funciones puras** sin
dependencias de React ni de Firebase. Todas con `try/catch` y fallback:

| Función | Qué hace | Riesgo |
|---------|----------|--------|
| `fechaHoyEnZona` | hoy en la zona del negocio | DST |
| `sumarDias` | `'YYYY-MM-DD' + n` | **bisiestos, cambio de año** |
| `formatearFechaLarga` | `'Sábado 13 de septiembre de 2026'` | locale |
| `diaKeyEnZona` / `horaEnZona` | ms epoch → `'YYYY-MM-DD'` / `'HH:MM'` | **medianoche UTC** |
| `formatearTelefono` | `'+573001234567'` → `'300 123 4567'` | prefijos por país |
| `fechaHoraAUtc` | `'YYYY-MM-DD' + 'HH:MM'` → Date UTC | **offset + DST (2 iteraciones)** |
| `descargarICS` / `generarEnlaceGoogleCalendar` | .ics y URL de Calendar | **fusión con `fICal`** |

**Lo que aprendí de este archivo:** `fechaHoraAUtc` itera 2 veces para clavar el
offset con DST. Es un detalle que parece over-engineering y no lo es: con un
solo pase, en el día del cambio de horario, la hora se va 1 hora. Y como los
datos de negocio viajan como `'YYYY-MM-DD'` (sin hora) **a propósito**, para no
depender de la zona horaria del dispositivo, ese es el punto donde el error se
colaría.

**Gaps de cobertura que dejó el plan para la semana 2** (y que ya confirmé):
- `sumarDias`: `2028-02-28` (bisiesto), `2027-02-28`, cambio de año.
- `fechaHoraAUtc`: `''`, `'25:00'`, `'2026-02-30'` (fecha que no existe).
- `formatearTelefono`: vacío, 9 dígitos, 10, `+57`/`+52`/`+51`, con espacios.

Los tests actuales cubren **43 casos** en 5 archivos. Es la capa más sana del
proyecto.

---

## 5. El semáforo del plan está desactualizado

El plan §1.2 clasifica los specs E2E como 🟢 local / 🔵 GCP. **El código no lo
respeta.** El corte real es otro:

> **¿El spec necesita un cliente autenticado?**

- 9 de 12 specs usan `signInEnPagina` → login real contra Auth → requieren GCP.
- Solo 2 (`booking-pom`, `horarios`) no hacen login — **pero igual dependen del
  `globalSetup`**, que siembra datos. No hay ningún spec autónomo.

Además `booking-pom.spec.js` busca el negocio **`mi-negocio`** (no `e2e-tienda`),
mientras el resto de la suite siembra `e2e-tienda`. Son dos negocios de prueba
distintos y eso va a surprisingar en la semana 8.

---

## 6. Checklist: ¿qué sé del código y qué me falta?

- [x] Estructura de Firestore y por qué hay dos tipos de colección
- [x] Las 38 reglas de negocio y cuáles no tienen test
- [x] Cómo funciona el harness y por qué estaba a medio usar
- [x] Por qué `fecha.js` es la clase de código más testeable del repo
- [x] Por qué el semáforo del plan no cuadra con el código
- [ ] `frontend/src/BookingApp.jsx` (106 KB) — el flujo de reserva del cliente
- [ ] `frontend/src/AdminDashboard.jsx` (157 KB) — el panel del dueño
- [ ] `middleware.go` — cómo se autentica cada request
- [ ] `firestore.rules` — las reglas de seguridad (semana 13)
