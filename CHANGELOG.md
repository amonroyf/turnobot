# Changelog — Turnobot

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
