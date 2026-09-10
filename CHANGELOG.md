# Changelog — Turnobot

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
