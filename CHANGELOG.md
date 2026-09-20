# Changelog — Turnobot

## 2026-09-20 (clase predefinida: herencia real)

- El atado servicio/profesional del espacio deja de ser decorativo: al reservar un espacio con atados (modo espacio, sin elegir), el backend hereda `servicio_id`/`emp_id` — la cita lleva nombre, duración y precio reales del servicio y queda en la agenda del profesional (evento de Calendar, portal del empleado, "con Ana" en MisCitas).
- `slots` y `primer-hueco` con `recurso_id` usan la duración del servicio atado (rejilla correcta para clases de 30/90 min, no solo 60).
- Si el empleado atado no ofrece el servicio atado se rechaza; espacio con instructor pero sin servicio no exige especialidad.
- Reserva: tarjetas de espacio muestran "Yoga · con Ana · ⏱️ 60 min · $30.000"; confirmación, ICS y Google Calendar usan los datos heredados.
- Test nuevo `TestRecursoClasePredefinidaHereda` (201 + nombre/duración/profesional heredados).
- Desplegado: frontend. Backend pendiente (falta el YAML de entorno).

## 2026-09-20 (espacios: creación en backend + clase predefinida)

- Nuevo `POST /api/v1/b/{slug}/recursos` (solo dueño): sanea nombre (1-100), capacidad (1-100), tipo válido y verifica `servicio_id`/`emp_id` si vienen; invalida caché. La creación ya no es `addDoc` directo.
- `Recurso` cambia de concepto: fuera `overbooking_pct` y `buffer_minutos` (capacidad exacta, sin colchón); dentro `servicio_id` + `emp_id` opcionales -> "clase grupal predefinida" (qué se dicta y quién la da).
- Disponibilidad y transacción sin buffer: la reserva ocupa [inicio, fin); un turno puede empezar justo cuando termina otro.
- Admin: form con selects de servicio y profesional (opcionales), lista muestra el atado ("Yoga · con Ana"), edición solo de cupos; fuera Extra % y Aseo.
- Rules: `recursos` con `allow create: if false` (solo backend), update valida capacidad + atados + horario. Tests actualizados (llenado exacto, horario propio sin buffer).
- Desplegado: frontend + rules. Backend pendiente de desplegar (falta el YAML de entorno).
- Datos viejos con `overbooking_pct`/`buffer_minutos` se ignoran (capacidad exacta).

## 2026-09-18 (flujo Espacio separado del servicio)

- El cliente elige primero el camino: "Reservar un servicio" o "Reservar un espacio" (solo si el negocio tiene espacios).
- Modo espacio: Espacio → Día → Hora → Confirmar, sin servicio ni profesional; `POST /book` acepta `servicioId` vacío con recurso (`Reserva de {espacio}`, 60 min, precio 0).
- Progreso, títulos y resúmenes con lenguaje por modo; "Cambiar entre servicio y espacio" visible.
- Test emulator: espacio sin servicio 201 + 400 sin ambos.

## 2026-09-18 (Fase 3: horario propio, aseo y lista nominal)

- `Recurso` suma `horario` (semanal, como empleados; vacío = jornada del negocio) y `buffer_minutos` (0-120, colchón solo al final: no exige doble hueco).
- `Booking.participantes[]` + `POST /book` acepta `participantes` (máx = cupos, 100 c/u); van al evento de Calendar, a `GET /citas` (`van`), al portal del empleado y a la agenda.
- Disponibilidad y transacción aplican horario propio + buffer; `reschedule` hereda.
- Admin: botón 🕒 Horario por espacio (mismo modal validado), campo aseo, "horario propio" visible; Booking muestra "¿Quiénes van?" (hasta 10 nombres) y resúmenes.
- Rules: `horario` válido + `buffer_minutos` 0-120. Tests emulator: día inactivo vacío, buffer bloquea 11:00, participantes guardados, suite verde.

## 2026-09-18 (Fase 2: cupos grupales + overbooking)

- `Recurso` suma `overbooking_pct` (0-100); capacidad efectiva = `cap × (100+%) / 100`.
- `Booking.cupos` (default 1) + `POST /book` acepta `cupos` (tope: la capacidad; la suma con overbooking la valida el servidor).
- Disponibilidad por cupos: `slots?recurso_id=&cupos=` responde `{slots, libres_por_hora}`; la transacción suma ocupados+pedidos vs efectiva (cierra la carrera de dos reservas al mismo cupo; `sin_cupo` 409).
- `primer-hueco?recurso_id=&cupos=`; `reschedule` mueve con los cupos de la cita.
- Frontend: "¿Cuántos van?" (1..cap, máx 20 botones) solo en espacios grupales; "¡Quedan N!" en horarios con ≤5 libres; resúmenes/MisCitas/Admin muestran personas; Admin edita cupos + extra % por espacio.
- Rules: `overbooking_pct` 0-100. Tests emulator: llenado, sin cupo, tope por reserva, overbooking 25%, suite completa verde.
- Pendiente: horarios propios por recurso, lista de participantes, overbooking automático por ausentismo.

## 2026-09-18 (Fase 1: espacios reservables — canchas, boxes)

- Modelo `Recurso` (`negocios/{slug}/recursos`: nombre, tipo, capacidad) + `recurso_id/name` en la reserva (desnormalizado como el servicio).
- `GET slots?recurso_id=` y `primer-hueco?recurso_id=`: disponibilidad exclusiva sobre la jornada del negocio (sin Calendar; Firestore resta reservas).
- `POST /book` acepta `recursoId` con profesional opcional (sin profesional no hay evento de Calendar; el push y el calendario anotan el espacio).
- `reschedule` consciente del recurso; `DELETE recursos/{id}` con resguardo 409; `GET /b/{slug}` incluye `recursos`.
- Rules: `recursos` lectura pública + escritura dueño (con validación de capacidad); índice nuevo `negocio_id + recurso_id + date_time`.
- Frontend: paso "¿Dónde? (opcional)" con iconos por tipo, "El local asigna", resúmenes/MisCitas/Admin/Empleado muestran el espacio; Admin crea y borra espacios.
- Tests emulator en verde (reserva con espacio, solape, libre/ocupado, 400s).
- Pendiente Fase 2: cupos grupales (capacidad N + overbooking) y horarios propios por recurso.

## 2026-09-18 (diálogos propios: adiós confirm()/alert() nativos)

- Nuevo `ConfirmDialog.jsx`: `DialogoProvider` + `useDialogo()` (`confirmar`/`avisar`/`pedirTexto` por promesas, `role=alertdialog`, Escape, foco inicial, botones 48px, fallback a nativos si no hay provider).
- Reemplazados los ~24 usos en Admin (cancelar, no llegó, devolver, eliminar servicio/equipo, guardar avisos, copiar), Empleado (cancelar, no llegó, devolver), Mis Citas (cancelar con detalle de la cita) y SuperAdmin (pausar/reanudar, borrado con doble confirmación + tipeo del ID, copiar enlace).
- Conceptos: sin bloqueo de pestaña, textos en palabras con consecuencia explícita, misma identidad visual, accesibilidad.

## 2026-09-18 (push: el checkbox ahora sí cumple + iOS honesto)

- `BookingApp.jsx` — el "🔔 Avísame" era decorativo (el backend ignoraba el campo y había que tocar otro botón después). Ahora al confirmar se auto-activa si quedó marcado; si el permiso falla queda el reintento manual. Microcopy honesto ("te pediremos permiso una sola vez").
- `BookingApp.jsx` — iPhone sin app instalada: Apple no despierta avisos web; se explica (Compartir → Añadir a inicio) en vez de prometer lo imposible.
- `firebase-messaging-sw.js` — `renotify` en tags fijas (la 2da reserva ya no llega muda) + botón de acción según destino ("Ver mi cita" / "Ver mis citas" / "Ver agenda").
- `usePushNotifications.js` — el aviso en primer plano navega a la página del aviso (antes solo enfocaba); `subscribe()` retorna éxito y el Admin muestra el error si falla.
- `reminders.go` — título "Tu cita es mañana" (el caso más común con 24h); `noshow.go` — push al cliente sin jerga ("No registramos tu llegada… Escríbenos para reagendar").

## 2026-09-18 (teléfono anti-abuso sin OTP)

La validación verifica formato (libphonenumber → E.164), no titularidad.
Endurecido sin costo por SMS:
- Throttle por número: 5 intentos de reserva/hora por teléfono+negocio (`phone_rate_limited`), además del tope 3/día y 10/min por IP+negocio.
- `GET /citas` exige ≥7 dígitos (frena barridos por prefijos).
- Documentado el límite real: sin OTP cualquiera puede reservar con número ajeno; la prueba de titularidad costaría un SMS/WhatsApp por reserva. El acoso (cancelar citas de otro) exige adivinar el citaID + el teléfono.

## 2026-09-18 (Firestore rules: tokens fuera del doc público)

**Hallazgo (auditoría S1 incompleta):** `negocios/{slug}` era de lectura pública Y guarda `push_token/push_tokens` del dueño (y el campo `refresh_token` existe en el esquema). Cualquiera con el slug leía los tokens FCM.
- Tokens del dueño migrados a `negocios/{slug}/privado/notificaciones` (solo dueño/superadmin; el backend usa Admin SDK). Lectura con fallback + migración sola al primer uso; registro/baja limpian los campos viejos.
- `negocios/{slug}`: lectura solo dueño/superadmin (la página pública usa el API sanitizado). `servicios` sigue público (solo nombre/duración/precio).
- Nueva subcolección `privado/{doc}` en reglas (denegada a terceros).
- Validación de rangos en reglas para las 4 políticas (`cancel_window_hours` 1-72, `booking_window_days` 1-365, tope/día 1-20, `min_notice` 0-10080); el backend también acota.
- Nuevo `GET /api/v1/b/{slug}/existe` (público, sin datos sensibles) para validar el enlace en el registro; `RegisterShop` ya no lee el doc directo.
- Correcciones que exige el despliegue: `no-show` sin credencial = 401 antes de tocar BD; tests viejos reparados (`TestCancelIdempotenteYLiberaSlot` con auth de cliente + ventana 2h; suite completa en verde con emulador).
- **Desplegar reglas con:** `TOKEN=$(gcloud auth print-access-token) node scripts/deploy-rules.mjs` + redesplegar backend (`only-backend`).

## 2026-09-18 (reglas comparadas con el mercado y corregidas)

Comparativa contra Fresha/Booksy/Vagaro/Mindbody/Pabau. Ver tabla en `backend/README.md`.

**Corregido (desvíos reales):**
- Ventana de cancelación configurable: nuevo `cancel_window_hours` (default **24h** como el mercado, tope 1-72h; antes 2h fijas). Aplica a cancelar y reprogramar; `cancelable` de `GET /citas` usa la misma ventana. El dueño la edita en Admin → "Tus reglas de reserva" (nueva tarjeta: ventana, aviso mínimo, días visibles, tope/día).
- Citas pasadas: nadie las cancela ni las mueve (el doc lo prometía pero el código lo permitía). La herramienta es "No llegó".
- Deshacer ampliado: cita de hoy **o acción <24h** (nuevo `no_show_at`; el `cancelled_at` ya existía). Antes un no-show marcado tarde no se podía corregir nunca.
- Recordatorio push: default **24h** (antes 2h) y techo de escaneo 6h → **72h** (cubre 24/48h del mercado).
- Tope diario: el mensaje 409 decía "3" aunque el negocio configurara otro valor; ahora usa el real.
- Rate limit: el estricto (10/min) frenaba TODOS los POST con llave solo-IP (un wifi compartido bloqueaba a todos). Ahora solo `book`/`reschedule` con llave IP+negocio.
- Slots mock (sin Calendar): tope 12 → 48 (se ocultaba la tarde completa).
- Contador `no_shows` por cliente (como el reporte Cancellation & No-Show del mercado): visible en CRM y CSV; se revierte al deshacer.
- Docs que mentían corregidos: skill (tope "1/día" → 3 configurable; ventana 2h → configurable) y e2e `reglas-negocio` (esperaba un `cancel_window` 403 que no existía; ahora prueba la regla real: 409 `too_late_to_cancel`).

**Brecha consciente (no implementada):** seña/cuota de no-show con tarjeta en archivo (Booksy/Vagaro/Pabau) — requiere pagos en línea (PSE/Nequi/Bold). La prevención actual es ventana 24h + contador + recordatorio.

## 2026-09-18 (backend: reglas por actor + reprogramar)

### Reglas de negocio que se exigían en docs pero no en código
- `main.go` — `DELETE citas/{id}` ahora exige la ventana de 2h al **cliente** (`too_late_to_cancel` con mensaje en palabras); dueño y equipo siempre pueden. Nueva `clientePuedeCancelar` + `policy_test.go`.
- `undo.go` — deshacer una cancelación **recrea el evento de Google Calendar** (cancelar lo borraba y el campo quedaba huérfano).

### Nuevos endpoints (retrocompatibles)
- `GET slots?emp_id=any` — una sola llamada une a todos los que ofrecen el servicio (`{slots, asignado_por_hora, profesionales}`); con emp concreto sigue el array plano.
- `GET slots/primer-hueco` — primer horario libre hasta 14 días (por profesional o `any`).
- `POST citas/{id}/reschedule` — **mover** la cita sin cancelar+recrear: no toca CRM/visitas, mueve el evento de Calendar, resetea `reminder_sent`, respeta antelación mínima y tope diario.
- `MisCitas.jsx` — botón "Cambiar hora" por cita (día + horas libres + confirmación); `BookingApp.jsx` usa `any` y `primer-hueco` con fallback al backend viejo.

## 2026-09-18

### Docs al día + TZ portal empleado

- `README.md` y `backend/README.md` — tabla completa de endpoints (undo, push-test, check-reminders, rutas de empleado…), vars `CRON_SECRET`/`EMPLOYEE_TOKEN_KEY`, No-Show actualizado
- `.agents/skills/turnobot-deploy.md` — `VITE_API_URL` obligatoria en el build (el error que tumbó prod una vez)
- `main.go` — `employeeCitasHandler` usa la zona del negocio en vez de Bogotá hardcodeada

## 2026-09-17

### Sin WhatsApp automático al confirmar

- `BookingApp.jsx` — eliminada la apertura automática de WhatsApp al confirmar la cita. Queda el botón manual "Tengo una duda (Escribir al local)".

### Fix: "Activar recordatorio" no hacía nada

- Causa: la verificación de teléfono comparaba E.164 contra dígitos nacionales (403 silencioso). Ahora compara contra todas las variantes (`phoneQueryKeys`).
- `BookingApp.jsx` — el botón muestra el motivo del fallo (permiso bloqueado, red, token) + "Intentar de nuevo" en vez de quedarse mudo.

## 2026-09-15

### Seguridad S1+S3 e integridad S2

**Críticos (S1):**
- `firestore.rules` — `empleados` sin lectura pública (guardaban `refresh_token` y hash `login_pin`). Verificado en vivo: 403 sin auth. Flujos públicos usan el API sanitizado; paneles van autenticados.
- `EMPLOYEE_TOKEN_KEY` por env (fail-closed): la llave HMAC estaba hardcodeada en git. Requiere redesplegar backend CON la variable o no arranca. Invalida sesiones de empleado activas.

**Integridad (S2):**
- `cancel`/`no-show`/`undo` ahora en `RunTransaction` (marca + CRM atómicos, re-chequeo anti-doble-aplicado). Builders compartidos `clienteCRMData`/`negocioStatsData`.
- `undo` resetea `reminder_sent` (cita restaurada vuelve al radar del cron).

**Endurecimiento (S3):**
- Lockout de PIN: 5 fallos = 15 min de bloqueo por (negocio, empleado) + logs (nunca el PIN). Además del rate-limit 10/min/IP existente.

### Recordatorios push a clientes + resumen al dueño (cron)

**Archivos nuevos:**
- `backend/reminders.go` — `POST /api/v1/check-reminders`: busca citas próximas, push al cliente con token, un solo push resumen al dueño, marca `reminder_sent`

**Archivos modificados:**
- `backend/main.go` — campos `ClientPushToken`/`ReminderSent` en `Booking`, `clientePushToken` en `BookingRequest`, ruta `/api/v1/check-reminders`
- `backend/push.go` — helper `sendPushToClient` (solo-data)
- `frontend/src/BookingApp.jsx` — checkbox "🔔 Avísame antes de mi cita", adjunta token FCM al reservar
- `DEPLOY.md` — sección del cron `turnobot-reminders`

**Infraestructura:**
- Job `turnobot-reminders` (Cloud Scheduler, cada 15 min, `America/Bogota`)
- Secreto `CRON_SECRET` (header `X-Cron-Secret`; super admin como alternativa)
- Ventana por negocio: `reminder_hours_before` (default 2h)

### Auditoría push: 3 bugs + mejoras (A–I)

**Bugs corregidos:**
- `push.go` — `registerClientPushTokenHandler` resetea `reminder_sent=false` (antes, activar tarde = recordatorio perdido)
- Nuevo `DELETE /api/v1/b/{slug}/push-token` + `deleteToken()` en el hook: "Desactivar" ahora sí deja de enviar (antes seguía llegando)
- `isTokenGone`/`clearOwnerToken`: tokens muertos (app borrada, token rotado) se limpian en vez de reintentarse eternamente; igual para tokens de cliente en el cron

**Mejoras:**
- `reminders.go` — `reminder_sent` solo se marca si se envió o no había token (fallos transitorios reintentan); resumen del dueño a todos sus dispositivos
- Multi-dispositivo dueño: array `push_tokens` (ArrayUnion/ArrayRemove) + legacy `push_token`
- Toast en app cuando el push llega con el panel abierto (`turnobot-push` + banner en `AdminDashboard`)
- `client-push-token` verifica teléfono contra la reserva
- `sendPushToOwner` vía caché (ahorra 1 lectura por reserva); nota de limitación iOS en el SW

### Push en segundo plano (bandeja del sistema)

- `push.go` — header `Urgency: high` en todos los webpush (despierta el SW en Doze/ahorro)
- `firebase-messaging-sw.js` — `skipWaiting` + `clients.claim` (el SW nuevo toma control sin cerrar pestañas) y `requireInteraction: true` (persiste en bandeja)
- Hooks dueño/empleado — en primer plano ahora muestran toast + notificación del sistema (antes solo toast)

### Botón "Enviarme una prueba" (push del dueño)

- `POST /api/v1/b/{slug}/push-test` (solo dueño): push de prueba a todos sus dispositivos, con conteo `sent/total`; limpia tokens muertos que encuentre
- `AdminDashboard.jsx` — botón en la tarjeta de push (Ajustes) con estado de envío y mensaje de resultado

### Push de empleados conectado + paridad con dueño

- `main.go`/`push.go` — `sendPushToEmployee`: push al profesional asignado en reserva nueva y en el cron (`emp_ok` en la respuesta); limpia tokens muertos; campo `PushToken` en `Employee` (oculto en JSON)
- Nuevo `DELETE /api/v1/b/{slug}/employee/{empId}/push-token` (baja real con token de empleado)
- `useEmployeePushNotifications` — baja real (`deleteToken` + backend), evento `turnobot-push` en primer plano; `EmployeeDashboard` con botón Desactivar, aviso de bloqueadas y toast
- `vite.config.js` — `start_url: '/'` (antes `/admin`: quien instalaba desde la tienda abría el login del dueño)
- Validación de longitud (512) en registro de token de empleado

### Auditoría de zonas horarias (hora colombiana)

- `AdminDashboard.jsx` — la query de agenda usaba medianoche del dispositivo; ahora usa medianoche en zona del negocio (`fechaHoraAUtc`). Con TZ distinta se excluían citas reales de hoy.
- `MisCitas.jsx` / `EmployeeDashboard.jsx` — cálculo de "mañana" con aritmética de strings (`sumarDias`), inmune a TZ del dispositivo.
- Backend verificado: almacenamiento en instantes absolutos, formato y límites de día siempre con `shopLocation`, comparaciones pasado/futuro por instante (independientes de TZ), eventos Calendar etiquetados con la zona del negocio.

### Fix: botón Deshacer oculto en vista del empleado

- `frontend/src/EmployeeDashboard.jsx` — `isToday` se calculaba en UTC (`toISOString`); desde las 7pm en Colombia ocultaba "↩️ Deshacer" aunque el backend lo permitía. Ahora usa la zona del negocio (igual que el panel del dueño).

### Botón "Calendario de Google" en pantalla de éxito

**Archivos modificados:**
- `frontend/src/fecha.js` — `generarEnlaceGoogleCalendar` (URL template oficial, reusa `fechaHoraAUtc`/`fICal`)
- `frontend/src/BookingApp.jsx` — botón principal blanco con logo G (inline SVG) + `.ics` como opción secundaria

### Fix: notificaciones push duplicadas

**Causa:** el backend enviaba payload `Webpush.Notification` y el service
worker volvía a mostrarla con `showNotification` en `onBackgroundMessage`
(doble render del mismo mensaje).

**Archivos modificados:**
- `backend/push.go` — mensaje solo-data (`title/body/icon/url/tag` en `Data`, sin `Webpush.Notification`)
- `frontend/public/firebase-messaging-sw.js` — lee `payload.data`, `tag: "new-booking"` + `renotify: false`
- `frontend/src/BookingApp.jsx` — guard `enviandoRef` contra doble submit en `confirmarCita` (evita crear dos reservas y dos pushes)

### Cambio de URL del backend (Cloud Run recreado)

- Nueva URL: `https://turnobot-850305350371.us-central1.run.app`
- Actualizados: `DEPLOY.md`, `deploy.sh`, `scripts/load-test.js`, `frontend/README.md`, e2e specs (`smoke-prod`, `horarios`)
- Nota: si se usa Google OAuth, registrar el nuevo `REDIRECT_URL`
  (`.../auth/google/callback`) en la consola de Google Cloud

---

## 2026-09-10

### Documentación y Auditoría de Producción

**Archivos nuevos:**
- `DEPLOY.md` — Guía completa de despliegue (infraestructura, CI/CD, monitoreo, seguridad)

**Archivos modificados:**
- `README.md` — Referencia a DEPLOY.md
- `CHANGELOG.md` — Registro de este changelog

**Infraestructura agregada:**
- `middleware.go` — CORS restringido, rate limiting, security headers, structured logging
- `cache.go` — Caché de negocio (TTL 5min), pool de goroutines (máx 10 concurrentes)
- `.github/workflows/ci.yml` — Pipeline CI/CD (build → test → deploy)
- `scripts/firestore-backup.sh` — Backup automático de Firestore
- `frontend/src/ErrorBoundary.jsx` — Error boundary para React
- `frontend/public/firebase-messaging-sw.js` — Service Worker para push notifications

**Mejoras de seguridad:**
- CORS restringido a dominios permitidos (antes era `*`)
- Rate limiting: 60/min general, 10/min booking
- Security headers: HSTS, X-Frame-Options, X-Content-Type-Options, CSP
- Health check real (verifica Firestore, antes era hardcoded "OK")
- Input validation en booking (campos requeridos, longitud nombre)
- Soft delete para reservas (antes era borrado físico)
- Graceful shutdown (SIGTERM/SIGINT)

**Mejoras de rendimiento:**
- Caché en memoria del negocio (TTL 5min)
- Pool de goroutines para push (máx 10 concurrentes)
- Batch delete chunks de 500 documentos
- Lazy loading de componentes React (code splitting)

---

## 2026-09-10

### Notificaciones Push (Web Push FCM)

**Archivos nuevos:**
- `backend/push.go` — Funciones de envío push usando Firebase Admin SDK
- `backend/pushHandler.go` — Handlers HTTP: check-reminders, markNoShow, registerPushToken
- `frontend/src/pushNotifications.js` — Registro de permiso push y escucha de mensajes

**Archivos modificados:**
- `backend/main.go` — Nuevo campo `PushToken` en struct `Negocio`, rutas nuevas, inicialización FCM
- `frontend/src/firebase.js` — Exportado `app` para messaging
- `frontend/src/AdminDashboard.jsx` — Botón "No Llegó", registro automático de push

**Endpoints nuevos:**
- `GET /api/v1/b/{slug}/check-reminders` — Verificar y enviar recordatorios push
- `POST /api/v1/b/{slug}/no-show/{id}` — Marcar cita como no-show
- `POST /api/v1/b/{slug}/register-push-token` — Registrar token FCM del dueño

### Cloud Scheduler

**Job creado:**
- `turnobot-reminders` — Cada 5 minutos ejecuta check-reminders
- Schedule: `*/5 * * * *`
- Endpoint: `GET /api/v1/b/turnobot/check-reminders`

### Firestore Indexes

**Índices compuestos nuevos:**
- `negocio_id + date_time` — Para check-reminders (recordatorios push)

### No-Show

**Backend:**
- Nuevo campo `no_show` en struct `Booking`
- Endpoint `POST /api/v1/b/{slug}/no-show/{id}` para marcar no-show

**Frontend:**
- Botón "No Llegó" en tarjetas de citas futuras del admin

---

## 2026-09-09

### Optimización de Firestore (Composite Indexes)

**Archivos modificados:**
- `backend/main.go` — Funciones optimizadas con queries compuestas
- `firestore.indexes.json` — Índices compuestos para reservas

**Funciones optimizadas:**
- `firestoreBookedIntervals` — Query compuesta: negocio_id + emp_id + date_time
- `listCitasHandler` — Query compuesta: user_phone + negocio_id + date_time
- `hasBookingOnDate` — Query compuesta: user_phone + negocio_id + date_time

### Seguridad Firestore Rules

**Archivo modificado:** `firestore.rules`

**Cambios:**
- `reservas.create: if false` — Solo backend Go puede crear reservas
- Lectura por `owner_uid` directo (sin `get()`) para reservas y clientes

### Desnormalización de owner_uid

**Backend:**
- Nuevo campo `OwnerUID` en struct `Booking`
- Nuevo campo `OwnerUID` en documentos de clientes
- `upsertCliente` ahora recibe y guarda `owner_uid`

**Frontend:**
- Queries de reservas y clientes por `owner_uid` en lugar de `negocio_id`

### Límite Familiar/Anti-Spam

**Backend:**
- Límite de 3 citas por teléfono por día natural (antes era 1)
- Eliminada restricción de overlap (familias pueden agendar juntas)

### UX Mejoras

**BookingApp.jsx:**
- Auto-scroll al siguiente paso al seleccionar profesional o fecha
- Formato de moneda colombiana (`$100.000`)
- Formato de teléfono con `slice(-10)` para manejar country code

**AdminDashboard.jsx:**
- Citas agrupadas por hora (`agruparPorHora`)
- Validación de horarios en modal (inicio >= fin bloquea botón Guardar)
- Citas pasadas con opacity-60 y badge "Finalizada"

---

## 2026-09-08

### Estructura Inicial

- Backend Go en Cloud Run
- Frontend React + Vite + Tailwind en Firebase Hosting
- Firestore para persistencia
- Google Calendar integration
- OAuth por empleado
