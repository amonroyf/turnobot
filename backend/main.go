package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"

	"cloud.google.com/go/firestore"
	"github.com/nyaruka/phonenumbers"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/calendar/v3"
	"google.golang.org/api/option"
)

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

var (
	firestoreClient *firestore.Client
	googleOauthCfg  *oauth2.Config
	firebaseAuth    *auth.Client
	firebaseApp     *firebase.App
)

// errSlotConflict indica que el horario se ocupó entre la verificación y la
// escritura. Se usa para abortar la transacción de reserva.
var errSlotConflict = errors.New("slot ocupado por reserva concurrente")

// errServicioNoOfrecido indica que el empleado no ofrece el servicio (su
// lista servicios_ids cambió a mitad de la reserva). Aborta la transacción.
var errServicioNoOfrecido = errors.New("empleado no ofrece el servicio")

// ofreceServicio dice si el empleado puede realizar el servicio.
// Lista nil (empleados antiguos) = ofrece todos.
func ofreceServicio(emp Employee, servicioID string) bool {
	if emp.ServiciosIDs == nil {
		return true
	}
	for _, sID := range emp.ServiciosIDs {
		if sID == servicioID {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Data Models (optimizados para JSON y Firestore)
// ---------------------------------------------------------------------------

// Negocio (business) document stored in Firestore.
type Negocio struct {
	ID           string `json:"id"`
	Name         string `firestore:"name" json:"name"`
	OwnerUID     string `firestore:"owner_uid" json:"-"`
	RefreshToken string `firestore:"refresh_token" json:"-"` // Oculto en JSON
	CalendarID   string `firestore:"calendar_id" json:"-"`   // Oculto en JSON
	Whatsapp     string `firestore:"whatsapp" json:"whatsapp"`
	Direccion    string `firestore:"direccion" json:"direccion"`
	Horario      string `firestore:"horario" json:"horario"`
	Telefono     string `firestore:"telefono" json:"telefono"`
	TimeZone     string `firestore:"timezone" json:"timezone"`
	OpenTime     string `firestore:"open_time" json:"open_time"`
	CloseTime    string `firestore:"close_time" json:"close_time"`
	// MinNoticeMinutes es la antelación mínima para reservar (default 0).
	// Se configura por negocio; ausente o negativo = 0 (citas inmediatas).
	MinNoticeMinutes int `firestore:"min_notice_minutes" json:"min_notice_minutes"`
	// BookingWindowDays es la ventana de días visibles para reservar (default 30).
	BookingWindowDays int `firestore:"booking_window_days" json:"booking_window_days"`
	// MaxBookingsPerPhonePerDay es el límite de reservas por teléfono al día (default 3).
	MaxBookingsPerPhonePerDay int `firestore:"max_bookings_per_phone_per_day" json:"max_bookings_per_phone_per_day"`
	// ReminderDaysBefore y ReminderHoursBefore configuran los recordatorios
	// de Calendar e ICS (defaults 1 día y 2 horas antes).
	ReminderDaysBefore  int `firestore:"reminder_days_before" json:"reminder_days_before"`
	ReminderHoursBefore int `firestore:"reminder_hours_before" json:"reminder_hours_before"`
	// Suspended marca un negocio suspendido por el super admin: no acepta
	// reservas nuevas (slots y book responden 403).
	Suspended            bool          `firestore:"suspended" json:"suspended"`
	// PushToken almacena el token FCM del dispositivo del dueño para
	// recibir notificaciones push cuando un cliente reserva.
	PushToken            string        `firestore:"push_token" json:"-"`
	// PushTokens soporta multi-dispositivo: cada dispositivo del dueño que
	// activa notificaciones agrega su token (register los une con ArrayUnion).
	PushTokens           []string      `firestore:"push_tokens" json:"-"`
	StatsCitasActivas    int           `firestore:"stats_citas_activas" json:"stats_citas_activas,omitempty"`
	StatsTotalClientes   int           `firestore:"stats_total_clientes" json:"stats_total_clientes,omitempty"`
	StatsIngresosTotales int64         `firestore:"stats_ingresos_totales" json:"stats_ingresos_totales,omitempty"`
	CreatedAt            time.Time     `firestore:"created_at" json:"created_at,omitempty"`
	Servicios            []Service     `json:"servicios"`
	Empleados            []Employee    `json:"empleados"`
}

// Turno represents a single work shift within a day.
type Turno struct {
	Inicio string `json:"inicio" firestore:"inicio"` // "09:00"
	Fin    string `json:"fin" firestore:"fin"`       // "13:00"
}

// DiaHorario defines whether an employee works on a given day and their shifts.
type DiaHorario struct {
	Activo bool    `json:"activo" firestore:"activo"`
	Turnos []Turno `json:"turnos" firestore:"turnos"`
}

// HorarioSemanal stores the full weekly schedule for an employee with split shifts.
type HorarioSemanal struct {
	Lunes     DiaHorario `json:"lunes" firestore:"lunes"`
	Martes    DiaHorario `json:"martes" firestore:"martes"`
	Miercoles DiaHorario `json:"miercoles" firestore:"miercoles"`
	Jueves    DiaHorario `json:"jueves" firestore:"jueves"`
	Viernes   DiaHorario `json:"viernes" firestore:"viernes"`
	Sabado    DiaHorario `json:"sabado" firestore:"sabado"`
	Domingo   DiaHorario `json:"domingo" firestore:"domingo"`
}

// Employee sub-document under a negocio.
type Employee struct {
	ID         string          `json:"id"`
	Name       string          `firestore:"name" json:"name"`
	CalendarID string          `firestore:"calendar_id" json:"-"`
	Phone      string          `firestore:"phone" json:"-"`
	Horario    *HorarioSemanal `firestore:"horario" json:"horario,omitempty"`
	// ServiciosIDs limita qué servicios ofrece el empleado. Nil = todos
	// (empleados antiguos sin el campo). Se expone en JSON para que el
	// frontend filtre el paso 2.
	ServiciosIDs []string `firestore:"servicios_ids" json:"servicios_ids"`
	// LoginPIN es el PIN hasheado con bcrypt para login del empleado.
	// json:"-" evita que se envíe en la API pública.
	LoginPIN string `firestore:"login_pin" json:"-"`
	// PushToken es el token FCM del dispositivo del empleado para avisos de
	// sus citas (reserva nueva y recordatorios del cron).
	PushToken string `firestore:"push_token" json:"-"`
}

// Service offered by a business.
type Service struct {
	ID       string `json:"id"`
	Name     string `firestore:"name" json:"name"`
	Duration int    `firestore:"duration_minutes" json:"duration_minutes"`
	Price    string `firestore:"price" json:"price"`
}

// BookingRequest is the payload sent by the web frontend.
type BookingRequest struct {
	ServicioID      string `json:"servicioId"`
	EmpleadoID      string `json:"empleadoId"`
	Fecha           string `json:"fecha"`
	Hora            string `json:"hora"`
	ClienteNombre   string `json:"clienteNombre"`
	ClienteTelefono string `json:"clienteTelefono"`
	// ClienteNotas es la descripción opcional de lo que necesita (máx 500).
	ClienteNotas string `json:"clienteNotas,omitempty"`
	// ClientePushToken es el token FCM del navegador del cliente (opcional).
	// Se envía si aceptó "avísame antes de mi cita" al reservar y sirve para
	// el recordatorio del cron. Sin token no hay push al cliente.
	ClientePushToken string `json:"clientePushToken,omitempty"`
	// Website es un honeypot anti-bots: los humanos nunca lo llenan.
	// Si trae valor, la reserva se finge exitosa sin escribir nada.
	Website string `json:"website,omitempty"`
}

// Booking is a confirmed appointment.
type Booking struct {
	NegocioID      string    `firestore:"negocio_id"`
	OwnerUID       string    `firestore:"owner_uid"`
	EmpID          string    `firestore:"emp_id"`
	UserPhone      string    `firestore:"user_phone"`
	ClientName     string    `firestore:"client_name"`
	ServiceName    string    `firestore:"service_name"`
	DurationMinute int       `firestore:"duration_minutes,omitempty"`
	Price          int       `firestore:"price"`
	DateTime       time.Time `firestore:"date_time"`
	CalendarEvt    string    `firestore:"calendar_event_id,omitempty"`
	CreatedAt      time.Time `firestore:"created_at"`
	NoShow         bool      `firestore:"no_show" json:"no_show"`
	// Notes es la descripción de lo que necesita el cliente.
	Notes string `firestore:"notes,omitempty" json:"notes,omitempty"`
	// ClientPushToken es el token FCM del dispositivo del cliente para el
	// recordatorio previo a su cita (vacío = no aceptó avisos).
	ClientPushToken string `firestore:"client_push_token,omitempty"`
	// ReminderSent evita que el cron reenvíe el recordatorio.
	ReminderSent bool `firestore:"reminder_sent"`
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

func main() {
	ctx := context.Background()
	projectID := os.Getenv("GCP_PROJECT_ID")
	if projectID == "" {
		projectID = "stalwart-coast-439901-d0" // Default para pruebas
	}

	// 1. Conexión a Firestore
	var err error
	firestoreClient, err = firestore.NewClient(ctx, projectID)
	if err != nil {
		log.Fatalf("Error conectando a Firestore: %v", err)
	}
	defer firestoreClient.Close()

	// 1b. Llave de sesión de empleados (fail-closed: sin esto no hay login).
	employeeTokenKey = []byte(os.Getenv("EMPLOYEE_TOKEN_KEY"))
	if len(employeeTokenKey) < 32 {
		log.Fatalf("EMPLOYEE_TOKEN_KEY ausente o muy corta (mínimo 32 caracteres)")
	}

	// 1c. Firebase Auth para verificar el token del dueño (operaciones de admin)
	fbApp, err := firebase.NewApp(ctx, &firebase.Config{ProjectID: projectID})
	if err != nil {
		log.Fatalf("Error inicializando Firebase App: %v", err)
	}
	firebaseApp = fbApp
	firebaseAuth, err = fbApp.Auth(ctx)
	if err != nil {
		log.Fatalf("Error inicializando Firebase Auth: %v", err)
	}

	// 2. OAuth2 Google Calendar config
	googleOauthCfg = &oauth2.Config{
		ClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		ClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
		RedirectURL:  os.Getenv("REDIRECT_URL"),
		Scopes:       []string{calendar.CalendarScope},
		Endpoint:     google.Endpoint,
	}

	// 3. Rutas HTTP con middleware compuesto
	http.HandleFunc("/api/v1/b/", chainMiddleware(apiBookingLimiter(apiRouter), apiLimiter))
	http.HandleFunc("/auth/google/login", chainMiddleware(googleLoginHandler, apiLimiter))
	http.HandleFunc("/auth/google/callback", chainMiddleware(googleCallbackHandler, apiLimiter))
	http.HandleFunc("/health", chainMiddleware(healthHandler, apiLimiter))
	// Cron de recordatorios (Cloud Scheduler con X-Cron-Secret, o super admin).
	http.HandleFunc("/api/v1/check-reminders", chainMiddleware(checkRemindersHandler, apiLimiter))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Addr:         ":" + port,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Canal para manejar señales de apagado
	go func() {
		log.Printf("Servidor API REST escuchando en el puerto %s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Error iniciando servidor: %v", err)
		}
	}()

	// Esperar señal SIGINT/SIGTERM para apagado controlado
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	<-quit
	log.Println("Apagando servidor...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Error apagando servidor: %v", err)
	}
	log.Println("Servidor apagado correctamente")
}

// ---------------------------------------------------------------------------
// Enrutador
// ---------------------------------------------------------------------------

// apiRouter analiza la URL y dirige la petición al endpoint correcto.
func apiRouter(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/b/")
	parts := strings.Split(path, "/")
	slug := parts[0]

	if slug == "" {
		http.Error(w, "Negocio no especificado", http.StatusBadRequest)
		return
	}

	if len(parts) == 1 && r.Method == http.MethodGet {
		getNegocioHandler(w, r, slug)
		return
	}

	// NUEVA RUTA: Eliminación completa del negocio por parte del Super Admin
	if len(parts) == 1 && r.Method == http.MethodDelete {
		deleteNegocioHandler(w, r, slug)
		return
	}

	if len(parts) == 2 {
		action := parts[1]
		if action == "slots" && r.Method == http.MethodGet {
			getSlotsHandler(w, r, slug)
			return
		}
		if action == "book" && r.Method == http.MethodPost {
			bookHandler(w, r, slug)
			return
		}
		if action == "citas" && r.Method == http.MethodGet {
			listCitasHandler(w, r, slug)
			return
		}

	}

	if len(parts) == 3 && parts[1] == "citas" && r.Method == http.MethodDelete {
		cancelCitaHandler(w, r, slug, parts[2])
		return
	}

	// Deshacer cancelación/no-show: POST /api/v1/b/{slug}/citas/{citaID}/undo
	if len(parts) == 4 && parts[1] == "citas" && parts[3] == "undo" && r.Method == http.MethodPost {
		undoCitaHandler(w, r, slug, parts[2])
		return
	}

	if len(parts) == 3 && parts[1] == "no-show" && r.Method == http.MethodPost {
		markNoShowHandler(w, r, slug, parts[2])
		return
	}

	if len(parts) == 3 && parts[1] == "servicios" && r.Method == http.MethodDelete {
		deleteServicioHandler(w, r, slug, parts[2])
		return
	}

	if len(parts) == 3 && parts[1] == "servicios" && r.Method == http.MethodPut {
		updateServicioHandler(w, r, slug, parts[2])
		return
	}

	if len(parts) == 3 && parts[1] == "empleados" && r.Method == http.MethodDelete {
		deleteEmpleadoHandler(w, r, slug, parts[2])
		return
	}

	// Login de empleado con PIN: POST /api/v1/b/{slug}/employee-login
	if len(parts) == 2 && parts[1] == "employee-login" && r.Method == http.MethodPost {
		employeeLoginHandler(w, r, slug)
		return
	}

	// Citas del empleado: GET /api/v1/b/{slug}/employee/{empId}/citas
	if len(parts) == 4 && parts[1] == "employee" && parts[3] == "citas" && r.Method == http.MethodGet {
		employeeCitasHandler(w, r, slug, parts[2])
		return
	}

	// Registrar push token del empleado: POST /api/v1/b/{slug}/employee/{empId}/register-push-token
	if len(parts) == 4 && parts[1] == "employee" && parts[3] == "register-push-token" && r.Method == http.MethodPost {
		employeeRegisterPushTokenHandler(w, r, slug, parts[2])
		return
	}

	// Baja de push del empleado: DELETE /api/v1/b/{slug}/employee/{empId}/push-token
	if len(parts) == 4 && parts[1] == "employee" && parts[3] == "push-token" && r.Method == http.MethodDelete {
		employeeUnregisterPushTokenHandler(w, r, slug, parts[2])
		return
	}

	// Asignar PIN al empleado: POST /api/v1/b/{slug}/empleados/{empleadoID}/pin
	if len(parts) == 4 && parts[1] == "empleados" && parts[3] == "pin" && r.Method == http.MethodPost {
		setEmployeePinHandler(w, r, slug, parts[2])
		return
	}

	// Registro de token push del dueño (FCM)
	if len(parts) == 2 && parts[1] == "register-push-token" && r.Method == http.MethodPost {
		registerPushTokenHandler(w, r, slug)
		return
	}

	// Baja de token push del dueño (deja de recibir en ese dispositivo)
	if len(parts) == 2 && parts[1] == "push-token" && r.Method == http.MethodDelete {
		unregisterPushTokenHandler(w, r, slug)
		return
	}

	// Registro de token push del CLIENTE en una cita específica.
	// POST /api/v1/b/{slug}/citas/{citaID}/client-push-token
	if len(parts) == 4 && parts[1] == "citas" && parts[3] == "client-push-token" && r.Method == http.MethodPost {
		registerClientPushTokenHandler(w, r, slug, parts[2])
		return
	}

	// Los paneles mutan vía SDK directo (addDoc/updateDoc) sin pasar por Go:
	// tras hacerlo, llaman aquí para limpiar la RAM y evitar hasta 5min stale.
	if len(parts) == 3 && parts[1] == "cache" && parts[2] == "invalidate" && r.Method == http.MethodPost {
		invalidateCacheHandler(w, r, slug)
		return
	}

	http.Error(w, "Ruta no encontrada", http.StatusNotFound)
}

// ---------------------------------------------------------------------------
// Endpoints API REST
// ---------------------------------------------------------------------------

// GET /api/v1/b/{slug} -> datos del negocio, servicios y empleados
func getNegocioHandler(w http.ResponseWriter, r *http.Request, slug string) {
	// Lectura vía caché TTL 5min (cache.go): reduce lecturas de Firestore en
	// el endpoint más caliente. El objeto cacheado ya trae servicios y
	// empleados poblados con slices no-nil.
	negocio, err := getCachedNegocio(r.Context(), slug)
	if err != nil {
		http.Error(w, "Negocio no encontrado", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(negocio)
}

// isBusinessSuspended verifica si un negocio tiene suspended=true en Firestore.
// Lee directo (sin caché) a propósito: la suspensión la escribe el Super Admin
// vía SDK y debe aplicarse de inmediato en slots/book.
// Si el documento no se puede leer, devuelve false para no bloquear por falsos positivos.
func isBusinessSuspended(ctx context.Context, slug string) bool {
	doc, err := firestoreClient.Collection("negocios").Doc(slug).Get(ctx)
	if err != nil {
		return false
	}
	suspended, _ := doc.Data()["suspended"].(bool)
	return suspended
}

// GET /api/v1/b/{slug}/slots?emp_id=XYZ&servicio_id=ABC&fecha=YYYY-MM-DD
func getSlotsHandler(w http.ResponseWriter, r *http.Request, slug string) {
	// Negocio suspendido: no se ofrecen horarios.
	if isBusinessSuspended(r.Context(), slug) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "business_suspended",
			"message": "Este negocio no está aceptando reservas en este momento.",
		})
		return
	}

	empID := r.URL.Query().Get("emp_id")
	servicioID := r.URL.Query().Get("servicio_id")
	fechaStr := r.URL.Query().Get("fecha")

	if empID == "" || fechaStr == "" {
		http.Error(w, "Faltan parámetros emp_id o fecha", http.StatusBadRequest)
		return
	}

	parsedDate, err := time.Parse("2006-01-02", fechaStr)
	if err != nil {
		http.Error(w, "Formato de fecha inválido. Use YYYY-MM-DD", http.StatusBadRequest)
		return
	}

	// Agrega la lectura del servicio para calcular la rejilla según su duración
	// real (si el servicio no existe se usa el fallback de 60 min para previsualizar).
	_, duration, _, _ := resolveService(r.Context(), slug, servicioID)

	slots, err := getFreeSlots(r.Context(), slug, empID, parsedDate, duration)
	if err != nil {
		log.Printf("Error obteniendo slots: %v", err)
		http.Error(w, "Error calculando disponibilidad", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(slots)
}

// POST /api/v1/b/{slug}/book -> crea la reserva en Firestore y Google Calendar
func bookHandler(w http.ResponseWriter, r *http.Request, slug string) {
	var req BookingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Payload inválido", http.StatusBadRequest)
		return
	}

	// Negocio suspendido: se rechaza la reserva (el super admin lo controla).
	if isBusinessSuspended(r.Context(), slug) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "business_suspended",
			"message": "Este negocio no está aceptando reservas en este momento. Por favor, comunícate directamente con el local.",
		})
		return
	}

	// Honeypot anti-bots: si el campo trampa trae valor, se finge éxito sin
	// escribir nada (no se le avisa al bot que fue detectado).
	if req.Website != "" {
		log.Printf("Honeypot activado en %s (bot bloqueado)", slug)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":  true,
			"message":  "Cita agendada exitosamente",
			"event_id": "mock_event_123",
		})
		return
	}

	// Validar campos requeridos
	if req.ServicioID == "" || req.EmpleadoID == "" || req.Fecha == "" || req.Hora == "" || req.ClienteNombre == "" || req.ClienteTelefono == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "missing_fields",
			"message": "Faltan campos requeridos: servicio, profesional, fecha, hora, nombre y teléfono son obligatorios.",
		})
		return
	}

	// Validar longitud del nombre (1-100 caracteres)
	if len(req.ClienteNombre) < 1 || len(req.ClienteNombre) > 100 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "invalid_name",
			"message": "El nombre debe tener entre 1 y 100 caracteres.",
		})
		return
	}

	// Validar longitud de las notas (máx 500 caracteres)
	if len(req.ClienteNotas) > 500 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "notas_muy_largas",
			"message": "La descripción no puede superar los 500 caracteres.",
		})
		return
	}

	// Sanitizar y validar teléfono con libphonenumber (+E.164)
	telefonoLimpio, err := sanitizePhone(req.ClienteTelefono, defaultPhoneRegion)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "invalid_phone",
			"message": err.Error(),
		})
		return
	}
	req.ClienteTelefono = telefonoLimpio

	ctx := context.Background()
	parsedDate, err := time.Parse("2006-01-02", req.Fecha)
	if err != nil {
		http.Error(w, "Formato de fecha inválido. Use YYYY-MM-DD", http.StatusBadRequest)
		return
	}
	hour, err := time.Parse("15:04", req.Hora)
	if err != nil {
		http.Error(w, "Formato de hora inválido. Use HH:MM", http.StatusBadRequest)
		return
	}
	// Construir el instante exacto en la zona horaria del negocio
	loc := shopLocation(ctx, slug)
	eventDateTime := time.Date(
		parsedDate.Year(), parsedDate.Month(), parsedDate.Day(),
		hour.Hour(), hour.Minute(), 0, 0, loc,
	)

	// 0. Límite familiar/Anti-spam: un número de teléfono puede tener máximo 3 citas al día.
	if hasBookingOnDate(ctx, slug, req.ClienteTelefono, eventDateTime) {
		log.Printf("Límite diario de %s: ya tiene 3 citas el %s en %s", req.ClienteTelefono, req.Fecha, slug)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "max_per_day",
			"message": "Has alcanzado el límite máximo de 3 reservas para este día usando este número de WhatsApp. Por favor, comunícate directamente con el local para agendar turnos adicionales.",
		})
		return
	}

	// Resolver el nombre y la duración real del servicio a partir de su ID.
	// Un servicio inexistente se rechaza: evita reservas basura con precio 0.
	serviceName, duration, precioServicio, found := resolveService(ctx, slug, req.ServicioID)
	if !found {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "servicio_no_encontrado",
			"message": "El servicio seleccionado ya no existe. Por favor elige otro.",
		})
		return
	}

	// El empleado debe ofrecer este servicio (multi-especialidad). Falla
	// rápido aquí; la transacción lo re-verifica contra TOCTOU.
	empDoc, err := firestoreClient.Collection("negocios").Doc(slug).Collection("empleados").Doc(req.EmpleadoID).Get(ctx)
	if err != nil {
		http.Error(w, "Profesional no encontrado", http.StatusBadRequest)
		return
	}
	var empData Employee
	empDoc.DataTo(&empData)
	if !ofreceServicio(empData, req.ServicioID) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "servicio_no_ofrecido",
			"message": "El profesional seleccionado no realiza este servicio. Por favor, elige a otro profesional.",
		})
		return
	}

	// Antelación mínima: no se puede reservar con menos aviso del configurado
	// por el negocio (default 0 = citas inmediatas).
	minNotice := negocioMinNotice(ctx, slug)
	if time.Until(eventDateTime) < time.Duration(minNotice)*time.Minute {
		// Mensaje acorde a la magnitud: con default 0 el único rechazo posible
		// es un horario ya pasado (evita el absurdo "al menos 0 horas").
		mensaje := fmt.Sprintf("Las reservas requieren al menos %d horas de anticipación. Por favor elige otro horario o comunícate con el local.", (minNotice+59)/60)
		if minNotice < 60 {
			mensaje = fmt.Sprintf("Las reservas requieren al menos %d minutos de anticipación. Por favor elige otro horario o comunícate con el local.", minNotice)
		}
		if minNotice <= 0 {
			mensaje = "El horario elegido ya pasó. Por favor elige otro horario o comunícate con el local."
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "muy_pronto",
			"message": mensaje,
		})
		return
	}

	// 1. Verificación estricta de disponibilidad en el último milisegundo.
	// Verificación con la rejilla de duración pura.
	slotsActuales, err := getFreeSlots(ctx, slug, req.EmpleadoID, parsedDate, duration)
	if err != nil {
		log.Printf("Error verificando disponibilidad en el calendario: %v", err)
		http.Error(w, "Error verificando disponibilidad en el calendario", http.StatusInternalServerError)
		return
	}
	disponible := false
	for _, s := range slotsActuales {
		if s == req.Hora {
			disponible = true
			break
		}
	}
	if !disponible {
		log.Printf("Slot ocupado al confirmar: %s %s para emp %s en %s", req.Fecha, req.Hora, req.EmpleadoID, slug)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "slot_taken",
			"message": "El horario que elegiste acaba de ser reservado por alguien más. Por favor elige otro.",
		})
		return
	}

	// Obtener el owner_uid del negocio para desnormalizarlo (Seguridad y ahorro de costos)
	negDoc, err := firestoreClient.Collection("negocios").Doc(slug).Get(ctx)
	if err != nil {
		http.Error(w, "Error consultando el negocio", http.StatusInternalServerError)
		return
	}
	var negocioInfo Negocio
	negDoc.DataTo(&negocioInfo)

	// Crear evento en Google Calendar (o mock si no hay OAuth configurado)
	// con la duración real del servicio.
	eventID := createCalendarEvent(ctx, slug, req.EmpleadoID, serviceName, duration, eventDateTime, req.ClienteNotas, req.ClienteNombre, req.ClienteTelefono, negocioInfo.Direccion)

	// Escritura transaccional: re-verifica el solapamiento DENTRO de la
	// transacción para cerrar la race condition de doble reserva, y crea la
	// reserva + el upsert del CRM de forma atómica.
	eventEnd := eventDateTime.Add(time.Duration(duration) * time.Minute)
	// Token push del cliente (opcional): se sanea aquí, fuera de la
	// transacción. Tokens absurdos (>512 chars) se descartan.
	clientPushToken := strings.TrimSpace(req.ClientePushToken)
	if len(clientPushToken) > 512 {
		clientPushToken = ""
	}
	// bookTxn ejecuta UN intento transaccional. Se invoca dentro del loop
	// de reintentos de abajo; newRef se crea por intento para no reutilizar
	// IDs de intentos abortados.
	var citaID string
	bookTxn := func() error {
		newRef := firestoreClient.Collection("reservas").NewDoc()
		return firestoreClient.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
			// Ventana de búsqueda ampliada 2h hacia atrás para atrapar citas
			// largas previas que solapen con la nueva.
			q := firestoreClient.Collection("reservas").
				Where("negocio_id", "==", slug).
				Where("emp_id", "==", req.EmpleadoID).
				Where("date_time", ">=", eventDateTime.Add(-2*time.Hour)).
				Where("date_time", "<", eventEnd)
			docs, err := tx.Documents(q).GetAll()
			if err != nil {
				return err
			}
			for _, d := range docs {
				if d.Data()["cancelled"] == true {
					continue
				}
				var b Booking
				if err := d.DataTo(&b); err != nil {
					continue
				}
				dur := time.Duration(b.DurationMinute) * time.Minute
				if dur <= 0 {
					dur = 60 * time.Minute
				}
				if eventDateTime.Before(b.DateTime.Add(dur)) && b.DateTime.Before(eventEnd) {
					return errSlotConflict
				}
			}
			// Lecturas ANTES de cualquier escritura: Firestore prohíbe
			// "read after write" dentro de una transacción.
			cliRef := firestoreClient.Collection("clientes").Doc(clienteDocID(slug, req.ClienteTelefono))
			cliDoc, errCli := tx.Get(cliRef)
			isNewClient := errCli != nil || !cliDoc.Exists()

			// Re-verificar especialidad dentro de la transacción: el dueño
			// pudo editar servicios_ids entre la validación previa y el commit.
			empRef := firestoreClient.Collection("negocios").Doc(slug).Collection("empleados").Doc(req.EmpleadoID)
			empSnap, errEmp := tx.Get(empRef)
			if errEmp != nil {
				return errEmp
			}
			var empTxn Employee
			empSnap.DataTo(&empTxn)
			if !ofreceServicio(empTxn, req.ServicioID) {
				return errServicioNoOfrecido
			}

			if err := tx.Create(newRef, Booking{
				NegocioID:      slug,
				OwnerUID:       negocioInfo.OwnerUID,
				EmpID:          req.EmpleadoID,
				UserPhone:      req.ClienteTelefono,
				ClientName:     req.ClienteNombre,
				ServiceName:    serviceName,
				DurationMinute: duration,
				Price:          precioServicio,
		DateTime:       eventDateTime,
			CalendarEvt:    eventID,
			CreatedAt:      time.Now(),
			Notes:          req.ClienteNotas,
			ClientPushToken: clientPushToken,
		}); err != nil {
				return err
			}
			citaID = newRef.ID
			// 1. Cliente nuevo (ya leído arriba) suma al total general del negocio
			cliData := map[string]interface{}{
				"negocio_id":    slug,
				"owner_uid":     negocioInfo.OwnerUID,
				"cliente_phone": req.ClienteTelefono,
				"client_name":   req.ClienteNombre,
				"visits":        firestore.Increment(1),
				"total_spent":   firestore.Increment(precioServicio),
				"last_seen":     eventDateTime,
				"last_date_str": eventDateTime.Format("2006-01-02"),
				"updated_at":    time.Now(),
			}
			if isNewClient {
				cliData["created_at"] = time.Now()
			}
			if err := tx.Set(cliRef, cliData, firestore.MergeAll); err != nil {
				return err
			}

			// 2. Actualizar contadores maestros del negocio (lee SuperAdmin sin queries extra)
			negUpdates := []firestore.Update{
				{Path: "stats_citas_activas", Value: firestore.Increment(1)},
				{Path: "stats_ingresos_totales", Value: firestore.Increment(precioServicio)},
			}
			if isNewClient {
				negUpdates = append(negUpdates, firestore.Update{Path: "stats_total_clientes", Value: firestore.Increment(1)})
			}
			return tx.Update(firestoreClient.Collection("negocios").Doc(slug), negUpdates)
		})
	}

	// Reintentos con backoff para contención transaccional ("Transaction lock
	// timeout" bajo picos concurrentes sobre el mismo slot). errSlotConflict y
	// errServicioNoOfrecido son deterministas: no se reintentan.
	var txnErr error
	for attempt := 0; attempt < 3; attempt++ {
		txnErr = bookTxn()
		if txnErr == nil || errors.Is(txnErr, errSlotConflict) || errors.Is(txnErr, errServicioNoOfrecido) {
			break
		}
		log.Printf("Reintentando transacción de reserva en %s (intento %d/3): %v", slug, attempt+1, txnErr)
		time.Sleep(time.Duration(100*(attempt+1)) * time.Millisecond)
	}
	if txnErr != nil {
		if errors.Is(txnErr, errSlotConflict) {
			// Compensar: liberar el evento de Calendar creado fuera de la
			// transacción para no dejar eventos huérfanos.
			if eventID != "" && eventID != "mock_event_123" {
				deleteCalendarEvent(ctx, slug, req.EmpleadoID, eventID)
			}
			log.Printf("Slot ocupado en transacción: %s %s para emp %s en %s", req.Fecha, req.Hora, req.EmpleadoID, slug)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"error":   "slot_taken",
				"message": "El horario que elegiste acaba de ser reservado por alguien más. Por favor elige otro.",
			})
			return
		}
		if errors.Is(txnErr, errServicioNoOfrecido) {
			// Compensar igual que en slot ocupado: el evento ya se creó.
			if eventID != "" && eventID != "mock_event_123" {
				deleteCalendarEvent(ctx, slug, req.EmpleadoID, eventID)
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"error":   "servicio_no_ofrecido",
				"message": "El profesional seleccionado no realiza este servicio. Por favor, elige a otro profesional.",
			})
			return
		}
		log.Printf("Error en transacción de reserva: %v", txnErr)
		http.Error(w, "Error guardando la reserva", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"message":      "Cita agendada exitosamente",
		"cita_id":      citaID,
		"event_id":     eventID,
		"date_time":    eventDateTime.Format(time.RFC3339),
		"service_name": serviceName,
		"price":        precioServicio,
	})

	// Push notification fire-and-forget: notificar al dueño que hay reserva nueva
	go sendPushToOwner(context.Background(), slug, req.ClienteNombre, serviceName,
		eventDateTime.Format("2006-01-02"), eventDateTime.Format("15:04"))

	// Push al profesional asignado (si activó notificaciones en su portal).
	go sendPushToEmployee(context.Background(), slug, req.EmpleadoID, empData.PushToken,
		fmt.Sprintf("📅 Nueva reserva: %s", req.ClienteNombre),
		fmt.Sprintf("%s — %s a las %s", serviceName,
			eventDateTime.Format("2006-01-02"), eventDateTime.Format("15:04")),
		"emp-booking-"+citaID)
}


// GET /api/v1/b/{slug}/citas?telefono=3001234567 -> citas activas del cliente
func listCitasHandler(w http.ResponseWriter, r *http.Request, slug string) {
	telefono := r.URL.Query().Get("telefono")
	if telefono == "" {
		http.Error(w, "Falta parámetro telefono", http.StatusBadRequest)
		return
	}
	ctx := r.Context()

	docsByRef := map[string]*firestore.DocumentSnapshot{}
	now := time.Now()

	for _, key := range phoneQueryKeys(telefono) {
		keyDocs, err := firestoreClient.Collection("reservas").
			Where("user_phone", "==", key).
			Where("negocio_id", "==", slug).
			Where("date_time", ">", now).
			Documents(ctx).GetAll()

		if err != nil {
			log.Printf("Error consultando citas: %v", err)
			http.Error(w, "Error consultando citas", http.StatusInternalServerError)
			return
		}

		for _, d := range keyDocs {
			docsByRef[d.Ref.ID] = d
		}
	}

	var citasPendientes []*firestore.DocumentSnapshot
	for _, d := range docsByRef {
		citasPendientes = append(citasPendientes, d)
	}

	sort.Slice(citasPendientes, func(i, j int) bool {
		var bi, bj Booking
		citasPendientes[i].DataTo(&bi)
		citasPendientes[j].DataTo(&bj)
		return bi.DateTime.Before(bj.DateTime)
	})

	loc := shopLocation(ctx, slug)
	empNames := map[string]string{}
	empsDocs, _ := firestoreClient.Collection("negocios").Doc(slug).Collection("empleados").Documents(ctx).GetAll()
	for _, d := range empsDocs {
		var emp Employee
		d.DataTo(&emp)
		empNames[d.Ref.ID] = emp.Name
	}

	type citaJSON struct {
		ID         string `json:"id"`
		Servicio   string `json:"servicio"`
		Price      int    `json:"price"`
		Fecha      string `json:"fecha"`
		Hora       string `json:"hora"`
		EmpID      string `json:"emp_id"`
		EmpName    string `json:"emp_name"`
		Cancelable bool   `json:"cancelable"`
		Cancelled  bool   `json:"cancelled"`
		Iso        string `json:"iso"`
		Notes      string `json:"notes,omitempty"`
	}

	citas := []citaJSON{}
	for _, d := range citasPendientes {
		var b Booking
		d.DataTo(&b)
		citas = append(citas, citaJSON{
			ID:         d.Ref.ID,
			Servicio:   b.ServiceName,
			Price:      b.Price,
			Fecha:      b.DateTime.In(loc).Format("2006-01-02"),
			Hora:       b.DateTime.In(loc).Format("15:04"),
			EmpID:      b.EmpID,
			EmpName:    empNames[b.EmpID],
			Cancelable: b.DateTime.Sub(now) >= 2*time.Hour,
			Cancelled:  d.Data()["cancelled"] == true,
			Iso:        b.DateTime.In(loc).Format(time.RFC3339),
			Notes:      b.Notes,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(citas)
}

// DELETE /api/v1/b/{slug}/citas/{citaID} -> cancela la cita (Firestore + Google Calendar)
// Puede ser invocado por: el dueño, el empleado asignado, o el cliente (via phone match).
func cancelCitaHandler(w http.ResponseWriter, r *http.Request, slug, citaID string) {
	ctx := r.Context()
	docRef := firestoreClient.Collection("reservas").Doc(citaID)
	doc, err := docRef.Get(ctx)
	if err != nil {
		http.Error(w, "Cita no encontrada", http.StatusNotFound)
		return
	}

	var b Booking
	doc.DataTo(&b)
	if b.NegocioID != slug {
		http.Error(w, "Cita no encontrada", http.StatusNotFound)
		return
	}

	// Idempotencia: si ya estaba cancelada, éxito sin volver a tocar el CRM.
	if doc.Data()["cancelled"] == true {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "La cita ya estaba cancelada",
		})
		return
	}

	// AUTORIZACIÓN: dueño, empleado asignado, o cliente (por phone match).
	isOwner := isOwnerRequest(r, slug)
	isEmployee := !isOwner && isAssignedEmployeeRequest(r, slug, b.EmpID)
	isClient := !isOwner && !isEmployee && isClientRequest(r, b.UserPhone)
	if !isOwner && !isEmployee && !isClient {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "unauthorized",
			"message": "No autorizado para cancelar esta cita.",
		})
		return
	}

	// Borrar el evento de Google Calendar del empleado si existe
	if b.CalendarEvt != "" && b.CalendarEvt != "mock_event_123" {
		deleteCalendarEvent(ctx, slug, b.EmpID, b.CalendarEvt)
	}

	// Transacción atómica: marca + CRM (cliente y stats) se aplican juntos o
	// nada. Re-verifica dentro del tx para que dos cancelaciones concurrentes
	// no resten doble en el CRM.
	err = firestoreClient.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		snap, err := tx.Get(docRef)
		if err != nil {
			return err
		}
		if snap.Data()["cancelled"] == true {
			return errYaAplicado
		}
		if err := tx.Update(docRef, []firestore.Update{
			{Path: "cancelled", Value: true},
			{Path: "cancelled_at", Value: time.Now()},
		}); err != nil {
			return err
		}
		cliRef := firestoreClient.Collection("clientes").Doc(clienteDocID(slug, b.UserPhone))
		if err := tx.Set(cliRef, clienteCRMData(slug, b.UserPhone, -1, -b.Price), firestore.MergeAll); err != nil {
			return err
		}
		negRef := firestoreClient.Collection("negocios").Doc(slug)
		return tx.Set(negRef, negocioStatsData(-1, -b.Price), firestore.MergeAll)
	})
	if err != nil {
		if errors.Is(err, errYaAplicado) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": true,
				"message": "La cita ya estaba cancelada",
			})
			return
		}
		log.Printf("Error cancelando cita %s: %v", citaID, err)
		http.Error(w, "Error cancelando la cita", http.StatusInternalServerError)
		return
	}

	// Pre-computar fecha/hora en zona del negocio para push (ctx se cancela al responder)
	loc := shopLocation(ctx, slug)
	fechaStr := b.DateTime.In(loc).Format("2006-01-02")
	horaStr := b.DateTime.In(loc).Format("15:04")

	// Push al cliente: notificar que su cita fue cancelada
	if b.ClientPushToken != "" {
		go sendPushToClient(context.Background(), b.ClientPushToken,
			"❌ Cita cancelada",
			fmt.Sprintf("Tu cita de %s en %s fue cancelada.", b.ServiceName, slug),
			"/shop/"+slug, "cancel-"+citaID)
	}

	// Push al dueño/empleado: notificar si el CLIENTE fue quien canceló
	if isClient {
		go sendPushToOwnerCancellation(context.Background(), slug, b.ClientName, b.ServiceName, fechaStr, horaStr)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"message":      "Cita cancelada exitosamente",
		"cita_id":      citaID,
		"client_name":  b.ClientName,
		"user_phone":   b.UserPhone,
		"service_name": b.ServiceName,
		"date_time":    b.DateTime.Format(time.RFC3339),
	})
}

// clienteDocID genera el ID estable del documento de cliente a partir del
// negocio y el teléfono (E.164). Así un mismo cliente puede existir en varias
// tiendas sin colisionar, y el upsert siempre apunta al mismo documento.
func clienteDocID(slug, phone string) string {
	return slug + "__" + phone
}

// decrementCliente refleja una cancelación en el directorio de clientes
// (resta una visita y el valor del servicio cancelado).
// Usa Set con MergeAll en vez de Update: si el documento fue purgado o la
// reserva se sembró sin CRM (tests E2E), Update falla con "no entity to
// update"; el merge con Increment lo crea/atualiza igual que el upsert de
// bookHandler. Se incluyen negocio_id y cliente_phone para que el doc
// siempre sea atribuible en las queries del CRM.
// errYaAplicado indica que la mutación ya estaba aplicada (carrera entre dos
// requests concurrentes): el caller responde éxito idempotente sin tocar el CRM.
var errYaAplicado = errors.New("mutación ya aplicada")

// clienteCRMData construye el upsert del directorio de clientes con deltas
// arbitrarios (negativos = resta por cancelación/no-show, positivos = undo).
// Compartido por la vía directa y la transaccional para no duplicar lógica.
func clienteCRMData(slug, phone string, visitsDelta, spentDelta int) map[string]interface{} {
	return map[string]interface{}{
		"negocio_id":    slug,
		"cliente_phone": phone,
		"visits":        firestore.Increment(visitsDelta),
		"total_spent":   firestore.Increment(spentDelta),
		"updated_at":    time.Now(),
	}
}

// negocioStatsData construye el ajuste de contadores maestros del tenant.
func negocioStatsData(citasDelta, priceDelta int) map[string]interface{} {
	return map[string]interface{}{
		"stats_citas_activas":    firestore.Increment(citasDelta),
		"stats_ingresos_totales": firestore.Increment(priceDelta),
		"updated_at":             time.Now(),
	}
}

func decrementCliente(ctx context.Context, slug, phone string, price int) {
	if slug == "" || phone == "" {
		return
	}
	ref := firestoreClient.Collection("clientes").Doc(clienteDocID(slug, phone))
	_, err := ref.Set(ctx, clienteCRMData(slug, phone, -1, -price), firestore.MergeAll)
	if err != nil {
		log.Printf("Aviso: no se pudo actualizar al cliente %s en %s: %v", phone, slug, err)
	}
}

// updateNegocioStats mantiene actualizados los contadores maestros del tenant
// para evitar escaneos masivos en el panel de SuperAdmin (una sola lectura
// del doc en vez de N queries por negocio).
// NOTA: no invalida negocioCache a propósito — getNegocioHandler es el endpoint
// caliente y ningún consumidor del API lee estos stats; solo el SuperAdmin vía SDK.
func updateNegocioStats(ctx context.Context, slug string, citasDelta int, priceDelta int) {
	if slug == "" {
		return
	}
	ref := firestoreClient.Collection("negocios").Doc(slug)
	_, err := ref.Set(ctx, negocioStatsData(citasDelta, priceDelta), firestore.MergeAll)
	if err != nil {
		log.Printf("Aviso: no se pudo actualizar stats del negocio %s: %v", slug, err)
	}
}

// decrementClienteBulk refleja eliminaciones en cascada en el CRM, agregando
// por teléfono para no hacer un write por cada cita (visits -= n,
// total_spent -= suma de precios).
func decrementClienteBulk(ctx context.Context, slug string, citas []affectedBooking) {
	type ajuste struct{ count, total int }
	porTelefono := map[string]*ajuste{}
	for _, ab := range citas {
		if ab.b.UserPhone == "" {
			continue
		}
		a := porTelefono[ab.b.UserPhone]
		if a == nil {
			a = &ajuste{}
			porTelefono[ab.b.UserPhone] = a
		}
		a.count++
		a.total += ab.b.Price
	}
	for phone, a := range porTelefono {
		ref := firestoreClient.Collection("clientes").Doc(clienteDocID(slug, phone))
		// Set con MergeAll (no Update): tolera documentos purgados sin
		// romper la cascada con "no entity to update". Ver decrementCliente.
		_, err := ref.Set(ctx, map[string]interface{}{
			"negocio_id":    slug,
			"cliente_phone": phone,
			"visits":        firestore.Increment(-a.count),
			"total_spent":   firestore.Increment(-a.total),
			"updated_at":    time.Now(),
		}, firestore.MergeAll)
		if err != nil {
			log.Printf("Aviso: no se pudo ajustar al cliente %s en %s: %v", phone, slug, err)
		}
	}

	// SaaS: ajustar contadores maestros por la cascada (solo citas futuras).
	totalAjusteCitas := 0
	totalAjustePrecio := 0
	for _, ab := range citas {
		totalAjusteCitas++
		totalAjustePrecio += ab.b.Price
	}
	updateNegocioStats(ctx, slug, -totalAjusteCitas, -totalAjustePrecio)
}

// isOwnerRequest verifica que el request traiga un ID token de Firebase válido
// perteneciente al dueño del negocio (campo owner_uid). Se usa para las
// operaciones privilegiadas del panel (eliminación en cascada, cancelación
// interna del administrador).
func isOwnerRequest(r *http.Request, slug string) bool {
	if firebaseAuth == nil {
		return false
	}
	token := bearerToken(r.Header.Get("Authorization"))
	if token == "" {
		return false
	}
	tok, err := firebaseAuth.VerifyIDToken(r.Context(), token)
	if err != nil {
		log.Printf("Aviso: token inválido para %s: %v", slug, err)
		return false
	}
	doc, err := firestoreClient.Collection("negocios").Doc(slug).Get(r.Context())
	if err != nil {
		return false
	}
	var n Negocio
	doc.DataTo(&n)
	return tok.UID != "" && tok.UID == n.OwnerUID
}

// bearerToken extrae el token del header "Authorization: Bearer <token>".
func bearerToken(header string) string {
	const prefix = "Bearer "
	if len(header) < len(prefix) || header[:len(prefix)] != prefix {
		return ""
	}
	return header[len(prefix):]
}

// isAssignedEmployeeRequest verifica si el request proviene del empleado
// asignado a la cita (JWT de empleado con PIN). Retorna true si el token
// de empleado es válido y el emp_id coincide con el asignado.
func isAssignedEmployeeRequest(r *http.Request, slug, empID string) bool {
	token := bearerToken(r.Header.Get("Authorization"))
	if token == "" {
		return false
	}
	tokenSlug, tokenEmpID, err := verifyEmployeeToken(token)
	if err != nil || tokenSlug != slug || tokenEmpID != empID {
		return false
	}
	return true
}

// isClientRequest verifica si el request viene del cliente (por phone match).
// No usa autenticación fuerte: compara el header X-Client-Phone con el
// teléfono de la cita. Aceptable para cancelación de citas propias donde
// el riesgo es bajo (solo puede afectar sus propias citas).
// Usa phoneQueryKeys para manejar diferentes formatos (E.164, nacional, etc.).
func isClientRequest(r *http.Request, clientPhone string) bool {
	phone := r.Header.Get("X-Client-Phone")
	if phone == "" {
		return false
	}
	// Comparar contra todos los formatos posibles del teléfono
	for _, key := range phoneQueryKeys(phone) {
		if key == clientPhone {
			return true
		}
	}
	return false
}

// DELETE /api/v1/b/{slug}/servicios/{servicioID}
// Elimina el servicio y, en cascada, todas sus reservas futuras: borra los
// documentos con un Batch Write y libera los eventos en Google Calendar.
func deleteServicioHandler(w http.ResponseWriter, r *http.Request, slug, servicioID string) {
	if !isOwnerRequest(r, slug) {
		http.Error(w, "No autorizado", http.StatusUnauthorized)
		return
	}

	ctx := r.Context()
	servRef := firestoreClient.Collection("negocios").Doc(slug).Collection("servicios").Doc(servicioID)
	servDoc, err := servRef.Get(ctx)
	if err != nil {
		http.Error(w, "Servicio no encontrado", http.StatusNotFound)
		return
	}
	var svc Service
	servDoc.DataTo(&svc)

	deleted, affected := cascadeDeleteCitas(ctx, slug, "", svc.Name)

	batch := firestoreClient.Batch()
	batch.Delete(servRef)
	for _, ab := range affected {
		batch.Delete(ab.ref)
	}
	if _, err := batch.Commit(ctx); err != nil {
		log.Printf("Error borrando servicio %s en cascada: %v", servicioID, err)
		http.Error(w, "Error eliminando el servicio", http.StatusInternalServerError)
		return
	}

	deleteCitasCalendarEvents(ctx, slug, affected)

	// CRM: las citas eliminadas en cascada también restan del directorio.
	decrementClienteBulk(ctx, slug, affected)

	// INVALIDAR CACHÉ: releer los servicios restantes en la próxima consulta.
	negocioCache.Invalidate(slug)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":        true,
		"message":        "Servicio eliminado",
		"citas_borradas": deleted,
	})
}

// PUT /api/v1/b/{slug}/servicios/{servicioID}
// Actualiza campos del servicio (nombre, duración, precio, buffer).
func updateServicioHandler(w http.ResponseWriter, r *http.Request, slug, servicioID string) {
	if !isOwnerRequest(r, slug) {
		http.Error(w, "No autorizado", http.StatusUnauthorized)
		return
	}

	type req struct {
		Name            *string `json:"name,omitempty"`
		DurationMinutes *int    `json:"duration_minutes,omitempty"`
		Price           *string `json:"price,omitempty"`
	}
	var payload req
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Payload inválido", http.StatusBadRequest)
		return
	}

	clamp := func(v, min, max int) int {
		if v < min {
			return min
		}
		if v > max {
			return max
		}
		return v
	}

	updates := []firestore.Update{}
	if payload.Name != nil {
		updates = append(updates, firestore.Update{Path: "name", Value: *payload.Name})
	}
	if payload.DurationMinutes != nil {
		updates = append(updates, firestore.Update{Path: "duration_minutes", Value: clamp(*payload.DurationMinutes, 1, 8*60)})
	}
	if payload.Price != nil {
		updates = append(updates, firestore.Update{Path: "price", Value: *payload.Price})
	}

	if len(updates) == 0 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "Sin cambios que aplicar",
		})
		return
	}

	updates = append(updates, firestore.Update{Path: "updated_at", Value: time.Now()})
	servRef := firestoreClient.Collection("negocios").Doc(slug).Collection("servicios").Doc(servicioID)
	if _, err := servRef.Update(r.Context(), updates); err != nil {
		log.Printf("Error actualizando servicio %s: %v", servicioID, err)
		http.Error(w, "Error guardando el servicio", http.StatusInternalServerError)
		return
	}

	// INVALIDAR CACHÉ: refleja cambios de precio o nombre de inmediato.
	negocioCache.Invalidate(slug)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Servicio actualizado",
	})
}

// DELETE /api/v1/b/{slug}/empleados/{empleadoID}
// Elimina el profesional y, en cascada, todas sus reservas futuras: borra los
// documentos con un Batch Write y libera los eventos en Google Calendar.
func deleteEmpleadoHandler(w http.ResponseWriter, r *http.Request, slug, empID string) {
	if !isOwnerRequest(r, slug) {
		http.Error(w, "No autorizado", http.StatusUnauthorized)
		return
	}

	ctx := r.Context()
	empRef := firestoreClient.Collection("negocios").Doc(slug).Collection("empleados").Doc(empID)
	if _, err := empRef.Get(ctx); err != nil {
		http.Error(w, "Profesional no encontrado", http.StatusNotFound)
		return
	}

	deleted, affected := cascadeDeleteCitas(ctx, slug, empID, "")

	batch := firestoreClient.Batch()
	batch.Delete(empRef)
	for _, ab := range affected {
		batch.Delete(ab.ref)
	}
	if _, err := batch.Commit(ctx); err != nil {
		log.Printf("Error borrando empleado %s en cascada: %v", empID, err)
		http.Error(w, "Error eliminando el profesional", http.StatusInternalServerError)
		return
	}

	deleteCitasCalendarEvents(ctx, slug, affected)

	// CRM: las citas eliminadas en cascada también restan del directorio.
	decrementClienteBulk(ctx, slug, affected)

	// INVALIDAR CACHÉ: releer el equipo restante en la próxima consulta.
	negocioCache.Invalidate(slug)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":        true,
		"message":        "Profesional eliminado",
		"citas_borradas": deleted,
	})
}

// POST /api/v1/b/{slug}/cache/invalidate -> limpia la caché en RAM del negocio.
// La usan los paneles tras mutaciones vía SDK directo (addDoc/updateDoc de
// servicios, empleados, horarios o datos del local), que el backend no ve.
// Solo invalida memoria; no toca Firestore. Acepta dueño o Super Admin.
func invalidateCacheHandler(w http.ResponseWriter, r *http.Request, slug string) {
	if !isOwnerRequest(r, slug) && !isSuperAdminRequest(r) {
		http.Error(w, "No autorizado", http.StatusUnauthorized)
		return
	}
	negocioCache.Invalidate(slug)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Caché invalidada",
	})
}

// isSuperAdminRequest valida que el token provenga exclusivamente de la cuenta raíz
func isSuperAdminRequest(r *http.Request) bool {
	if firebaseAuth == nil {
		return false
	}
	token := bearerToken(r.Header.Get("Authorization"))
	if token == "" {
		return false
	}
	tok, err := firebaseAuth.VerifyIDToken(r.Context(), token)
	if err != nil {
		return false
	}
	// El UID hardcodeado de tu Super Admin en React
	return tok.UID == "0FF1nrcBnSPIdB1rMgYocmRnYUb2"
}

// DELETE /api/v1/b/{slug} -> Borrado masivo (Batch) de todo el tenant
func deleteNegocioHandler(w http.ResponseWriter, r *http.Request, slug string) {
	if !isSuperAdminRequest(r) {
		http.Error(w, "Acceso denegado: Se requiere rol de Super Administrador", http.StatusForbidden)
		return
	}

	ctx := r.Context()

	// 0. Limpiar Google Calendar ANTES de destruir Firestore: encuentra todas
	// las citas futuras del tenant (strings vacíos = sin filtro) y borra sus
	// eventos para no dejar citas fantasma en la agenda de los profesionales.
	// Debe ir primero porque necesita los calendar_event_id (reservas) y los
	// refresh_token (empleados) que se borran abajo.
	_, citasAfectadas := cascadeDeleteCitas(ctx, slug, "", "")
	deleteCitasCalendarEvents(ctx, slug, citasAfectadas)

	// Helper para borrar documentos en lotes (batch).
	// Trocea en bloques de 400 para respetar el límite de 500 writes por commit
	// y soportar tenants con miles de documentos sin colapsar.
	// deleteDocs borra en commits de hasta 400 (límite Firestore: 500).
	// Retorna error si algún commit falla, para que el loop paginado no
	// reintente eternamente sobre los mismos documentos.
	deleteDocs := func(docs []*firestore.DocumentSnapshot) error {
		batch := firestoreClient.Batch()
		count := 0
		flush := func() error {
			if count == 0 {
				return nil
			}
			if _, err := batch.Commit(ctx); err != nil {
				return err
			}
			batch = firestoreClient.Batch()
			count = 0
			return nil
		}
		for _, d := range docs {
			batch.Delete(d.Ref)
			count++
			if count >= 400 {
				if err := flush(); err != nil {
					return err
				}
			}
		}
		return flush()
	}
	// deleteQuery borra con paginación REAL: trae de a 400 y repite hasta
	// vaciar, sin cargar la colección entera en RAM. Con GetAll() un tenant
	// de 50k reservas tumbaría el contenedor de 512MB (OOM a medio borrar).
	// Solo aplica a colecciones no acotadas (reservas, clientes).
	deleteQuery := func(q firestore.Query) {
		for {
			docs, err := q.Limit(400).Documents(ctx).GetAll()
			if err != nil {
				log.Printf("Error consultando para borrado masivo de %s: %v", slug, err)
				break
			}
			if len(docs) == 0 {
				break
			}
			if err := deleteDocs(docs); err != nil {
				log.Printf("Error en commit de borrado masivo de %s: %v", slug, err)
				break
			}
			if len(docs) < 400 {
				break // última página
			}
		}
	}
	deleteCollection := func(col *firestore.CollectionRef) {
		// Subcolecciones acotadas por tamaño del equipo (servicios/empleados):
		// GetAll es seguro aquí. (CollectionRef no expone Limit/Query para
		// paginar; no usar col.Query — no existe en el SDK de Go.)
		docs, err := col.Documents(ctx).GetAll()
		if err != nil {
			log.Printf("Error consultando para borrado masivo de %s: %v", slug, err)
			return
		}
		if err := deleteDocs(docs); err != nil {
			log.Printf("Error en commit de borrado masivo de %s: %v", slug, err)
		}
	}

	// 1. Borrar todas las reservas y clientes asociados al negocio
	deleteQuery(firestoreClient.Collection("reservas").Where("negocio_id", "==", slug))
	deleteQuery(firestoreClient.Collection("clientes").Where("negocio_id", "==", slug))

	// 2. Borrar las subcolecciones del negocio
	deleteCollection(firestoreClient.Collection("negocios").Doc(slug).Collection("servicios"))
	deleteCollection(firestoreClient.Collection("negocios").Doc(slug).Collection("empleados"))

	// 3. Borrar el documento principal del negocio
	_, err := firestoreClient.Collection("negocios").Doc(slug).Delete(ctx)
	if err != nil {
		http.Error(w, "Error eliminando el documento principal", http.StatusInternalServerError)
		return
	}

	// Invalidar caché para no servir datos fantasma en lecturas subsecuentes.
	negocioCache.Invalidate(slug)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Negocio y datos asociados eliminados correctamente",
	})
}

// affectedBooking empareja un DocumentRef con el Booking leído antes del batch delete.
type affectedBooking struct {
	ref *firestore.DocumentRef
	b   Booking
}

// cascadeDeleteCitas encuentra las reservas futuras que deben eliminarse en
// cascada (por empleado y/o por nombre de servicio) y devuelve las citas
// afectadas con sus datos (para limpiar Google Calendar) y referencias (para el batch).
func cascadeDeleteCitas(ctx context.Context, slug, empID, serviceName string) (int, []affectedBooking) {
	docs, err := firestoreClient.Collection("reservas").
		Where("negocio_id", "==", slug).
		Documents(ctx).GetAll()
	if err != nil {
		log.Printf("Aviso: no se pudo consultar reservas para cascada de %s: %v", slug, err)
		return 0, nil
	}

	now := time.Now()
	var affected []affectedBooking
	for _, d := range docs {
		var b Booking
		d.DataTo(&b)
		if !b.DateTime.After(now) {
			continue
		}
		// Excluir canceladas
		if d.Data()["cancelled"] == true {
			continue
		}
		if empID != "" && b.EmpID != empID {
			continue
		}
		if serviceName != "" && b.ServiceName != serviceName {
			continue
		}
		affected = append(affected, affectedBooking{ref: d.Ref, b: b})
	}
	return len(affected), affected
}

// deleteCitasCalendarEvents libera en Google Calendar todos los eventos de las
// reservas eliminadas. Recibe los datos leídos ANTES del batch delete.
func deleteCitasCalendarEvents(ctx context.Context, slug string, citas []affectedBooking) {
	for _, ab := range citas {
		if ab.b.CalendarEvt != "" && ab.b.CalendarEvt != "mock_event_123" {
			deleteCalendarEvent(ctx, slug, ab.b.EmpID, ab.b.CalendarEvt)
		}
	}
}

// deleteCalendarEvent borra un evento del Google Calendar personal del empleado.
func deleteCalendarEvent(ctx context.Context, negocioID, empID, eventID string) {
	svc, emp, err := calendarServiceForEmployee(ctx, negocioID, empID)
	if err != nil {
		log.Printf("Aviso: %v. No se pudo borrar el evento %s.", err, eventID)
		return
	}

	if emp.CalendarID == "" || eventID == "" {
		return
	}

	if err := svc.Events.Delete(emp.CalendarID, eventID).Context(ctx).Do(); err != nil {
		log.Printf("Error borrando evento %s: %v", eventID, err)
	}
}

// resolveService busca el nombre y la duración real del servicio en Firestore.
// Retorna found=false si el servicio no existe (el caller decide: slots usa
// fallback, book rechaza con 400).
func resolveService(ctx context.Context, slug, servicioID string) (string, int, int, bool) {
	doc, err := firestoreClient.Collection("negocios").Doc(slug).Collection("servicios").Doc(servicioID).Get(ctx)
	if err != nil {
		return servicioID, 60, 0, false // Fallback: 60 minutos por defecto
	}
	var svc Service
	doc.DataTo(&svc)
	duration := svc.Duration
	if duration == 0 {
		duration = 60
	}
	name := svc.Name
	if name == "" {
		name = servicioID
	}
	return name, duration, parsePriceVal(svc.Price), true
}

// parsePriceVal convierte un precio almacenado como string ("15.000", "$20000")
// a su valor numérico en la moneda local. Devuelve 0 si no hay número válido.
func parsePriceVal(s string) int {
	d := digitsOnly(s)
	if d == "" {
		return 0
	}
	n, err := strconv.Atoi(d)
	if err != nil {
		return 0
	}
	return n
}

// bogotaLocation devuelve la zona horaria de Colombia. En el contenedor de
// Cloud Run (alpine, sin tzdata) LoadLocation puede fallar, así que se usa
// una zona fija UTC-5 como respaldo (Colombia no usa horario de verano).
func bogotaLocation() *time.Location {
	loc, err := time.LoadLocation("America/Bogota")
	if err != nil {
		return time.FixedZone("BOT", -5*60*60)
	}
	return loc
}

// getShopTimeZone devuelve la zona horaria configurada del negocio
// (campo "timezone" en Firestore) o un fallback seguro si no existe.
func getShopTimeZone(ctx context.Context, slug string) string {
	doc, err := firestoreClient.Collection("negocios").Doc(slug).Get(ctx)
	if err != nil {
		return "America/Bogota" // Fallback seguro
	}
	var negocio Negocio
	doc.DataTo(&negocio)
	if negocio.TimeZone == "" {
		return "America/Bogota"
	}
	return negocio.TimeZone
}

// negocioMinNotice devuelve la antelación mínima de reserva en minutos
// configurada por el negocio (default 0 si no existe o es inválida).
func negocioMinNotice(ctx context.Context, slug string) int {
	doc, err := firestoreClient.Collection("negocios").Doc(slug).Get(ctx)
	if err != nil {
		return 0
	}
	var n Negocio
	doc.DataTo(&n)

	// El 0 es un valor legítimo (citas inmediatas). Solo se bloquean negativos.
	if n.MinNoticeMinutes < 0 {
		return 0
	}
	return n.MinNoticeMinutes
}

// negocioBookingWindow devuelve la ventana de días para reservar (default 30).
func negocioBookingWindow(ctx context.Context, slug string) int {
	doc, err := firestoreClient.Collection("negocios").Doc(slug).Get(ctx)
	if err != nil {
		return 30
	}
	var n Negocio
	doc.DataTo(&n)
	if n.BookingWindowDays <= 0 {
		return 30
	}
	if n.BookingWindowDays > 365 {
		return 365
	}
	return n.BookingWindowDays
}

// negocioMaxBookings devuelve el límite de reservas por teléfono al día (default 3).
func negocioMaxBookings(ctx context.Context, slug string) int {
	doc, err := firestoreClient.Collection("negocios").Doc(slug).Get(ctx)
	if err != nil {
		return 3
	}
	var n Negocio
	doc.DataTo(&n)
	if n.MaxBookingsPerPhonePerDay <= 0 {
		return 3
	}
	if n.MaxBookingsPerPhonePerDay > 20 {
		return 20
	}
	return n.MaxBookingsPerPhonePerDay
}

// negocioReminders devuelve los recordatorios configurados (defaults 1d, 2h).
func negocioReminders(ctx context.Context, slug string) (daysBefore, hoursBefore int) {
	doc, err := firestoreClient.Collection("negocios").Doc(slug).Get(ctx)
	if err != nil {
		return 1, 2
	}
	var n Negocio
	doc.DataTo(&n)
	if n.ReminderDaysBefore <= 0 {
		daysBefore = 1
	} else {
		daysBefore = n.ReminderDaysBefore
	}
	if n.ReminderHoursBefore <= 0 {
		hoursBefore = 2
	} else {
		hoursBefore = n.ReminderHoursBefore
	}
	return daysBefore, hoursBefore
}

// remindersConfig genera los overrides de recordatorio de Google Calendar
// según la configuración del negocio (email a X días, popup a X días y X horas).
func remindersConfig(ctx context.Context, slug string) *calendar.EventReminders {
	days, hours := negocioReminders(ctx, slug)
	return &calendar.EventReminders{
		UseDefault: false,
		Overrides: []*calendar.EventReminder{
			{Method: "email", Minutes: int64(days * 24 * 60)},
			{Method: "popup", Minutes: int64(days * 24 * 60)},
			{Method: "popup", Minutes: int64(hours * 60)},
		},
		ForceSendFields: []string{"UseDefault"},
	}
}

// shopLocation devuelve el *time.Location del negocio, resolviendo la zona
// horaria desde Firestore con respaldo a Bogotá si es inválida o no existe.
func shopLocation(ctx context.Context, slug string) *time.Location {
	loc, err := time.LoadLocation(getShopTimeZone(ctx, slug))
	if err != nil {
		return bogotaLocation()
	}
	return loc
}

// workDayRange devuelve el intervalo [apertura, cierre) de la jornada operativa
// del negocio para un día concreto, leyendo open_time/close_time de Firestore.
// Si no están configurados o son inválidos, cae en el horario base 09:00-18:00.
func workDayRange(ctx context.Context, slug string, day time.Time) (time.Time, time.Time) {
	doc, err := firestoreClient.Collection("negocios").Doc(slug).Get(ctx)
	var openH, openM, closeH, closeM int
	okOpen, okClose := false, false
	if err == nil {
		var n Negocio
		doc.DataTo(&n)
		okOpen, openH, openM = parseClock(n.OpenTime)
		okClose, closeH, closeM = parseClock(n.CloseTime)
	}

	loc := shopLocation(ctx, slug)
	start := time.Date(day.Year(), day.Month(), day.Day(), 9, 0, 0, 0, loc)
	end := start.Add(9 * time.Hour)

	if okOpen {
		start = time.Date(day.Year(), day.Month(), day.Day(), openH, openM, 0, 0, loc)
	}
	if okClose {
		end = time.Date(day.Year(), day.Month(), day.Day(), closeH, closeM, 0, 0, loc)
	}
	// Guarda de integridad: nunca permitir jornada invertida o vacía
	if !end.After(start) {
		end = start.Add(9 * time.Hour)
	}
	return start, end
}

// parseClock interpreta un string "HH:MM" (ej. "09:00"). Devuelve ok, hora, minuto.
func parseClock(s string) (bool, int, int) {
	if s == "" {
		return false, 0, 0
	}
	parts := strings.Split(s, ":")
	if len(parts) != 2 {
		return false, 0, 0
	}
	h, errH := strconv.Atoi(strings.TrimSpace(parts[0]))
	m, errM := strconv.Atoi(strings.TrimSpace(parts[1]))
	if errH != nil || errM != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return false, 0, 0
	}
	return true, h, m
}

// defaultPhoneRegion determina el país (ISO 3166-1 alpha-2) usado para
// interpretar los números sin código de país. Por defecto Colombia.
const defaultPhoneRegion = "CO"

// sanitizePhone valida la estructura real del número con libphonenumber
// (reglas oficiales por operador/país) y lo normaliza a E.164 (ej. +573001234567).
// Rechaza números matemáticamente imposibles o sin asignación en la región.
func sanitizePhone(phone, defaultRegion string) (string, error) {
	num, err := phonenumbers.Parse(phone, defaultRegion)
	if err != nil {
		return "", fmt.Errorf("formato de número inválido")
	}

	// Verifica si el número es matemáticamente posible y está asignado en esa región
	if !phonenumbers.IsValidNumber(num) {
		return "", fmt.Errorf("el número ingresado no existe o no es válido para este operador")
	}

	// Normalizar al estándar internacional limpio (E.164: +573001234567)
	return phonenumbers.Format(num, phonenumbers.E164), nil
}

// digitsOnly devuelve solo los dígitos de un string (quita espacios, +, etc.).
func digitsOnly(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// phoneQueryKeys devuelve las variantes de búsqueda en Firestore para un
// teléfono: el valor crudo enviado, la versión E.164 (formato nuevo) y la
// nacional en dígitos (formato legado de reservas anteriores a +57...). Así
// "Mis citas", el límite diario y la doble reserva siguen funcionando con
// reservas creadas antes y después de la normalización.
func phoneQueryKeys(phone string) []string {
	keys := map[string]bool{}
	add := func(p string) {
		if p != "" && !keys[p] {
			keys[p] = true
		}
	}
	add(phone)
	if num, err := phonenumbers.Parse(phone, defaultPhoneRegion); err == nil && phonenumbers.IsValidNumber(num) {
		add(phonenumbers.Format(num, phonenumbers.E164))
		add(digitsOnly(phonenumbers.Format(num, phonenumbers.NATIONAL)))
	}
	out := make([]string, 0, len(keys))
	for k := range keys {
		out = append(out, k)
	}
	return out
}

// ---------------------------------------------------------------------------
// Google Calendar helpers (lógica centralizada)
// ---------------------------------------------------------------------------

// calendarServiceForEmployee busca el token en el documento del empleado.
func calendarServiceForEmployee(ctx context.Context, negocioID, empID string) (*calendar.Service, *Employee, error) {
	doc, err := firestoreClient.Collection("negocios").Doc(negocioID).Collection("empleados").Doc(empID).Get(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("empleado no encontrado: %w", err)
	}

	var emp struct {
		Employee
		RefreshToken string `firestore:"refresh_token"`
	}
	doc.DataTo(&emp)
	emp.ID = doc.Ref.ID

	if emp.RefreshToken == "" {
		// FIX: Retornar &emp.Employee en lugar de nil para que getFreeSlots
		// pueda leer el Horario del empleado y generar los turnos partidos.
		return nil, &emp.Employee, fmt.Errorf("el empleado no ha vinculado su google calendar")
	}

	token := &oauth2.Token{RefreshToken: emp.RefreshToken}
	client := googleOauthCfg.Client(ctx, token)
	svc, err := calendar.NewService(ctx, option.WithHTTPClient(client))

	return svc, &emp.Employee, err
}

// employeeDayHorario extracts the DiaHorario for a given weekday from the
// employee's HorarioSemanal, or nil if the employee has no per-employee schedule
// configured (which means the business-level workDayRange is used instead).
func employeeDayHorario(h *HorarioSemanal, day time.Weekday) *DiaHorario {
	if h == nil {
		return nil
	}
	switch day {
	case time.Monday:
		return &h.Lunes
	case time.Tuesday:
		return &h.Martes
	case time.Wednesday:
		return &h.Miercoles
	case time.Thursday:
		return &h.Jueves
	case time.Friday:
		return &h.Viernes
	case time.Saturday:
		return &h.Sabado
	case time.Sunday:
		return &h.Domingo
	}
	return nil
}

// splitShiftIntervals converts the employee's turnos for a given day into
// [start, end) intervals in the correct timezone. If the employee has no
// schedule or no active turnos, it returns nil (caller falls back to
// workDayRange).
func splitShiftIntervals(ctx context.Context, slug string, dia *DiaHorario, day time.Time) [][2]time.Time {
	if dia == nil || !dia.Activo || len(dia.Turnos) == 0 {
		return nil
	}
	loc := shopLocation(ctx, slug)
	var intervals [][2]time.Time
	for _, t := range dia.Turnos {
		okO, oh, om := parseClock(t.Inicio)
		okC, ch, cm := parseClock(t.Fin)
		if !okO || !okC {
			continue
		}
		start := time.Date(day.Year(), day.Month(), day.Day(), oh, om, 0, 0, loc)
		end := time.Date(day.Year(), day.Month(), day.Day(), ch, cm, 0, 0, loc)
		if end.After(start) {
			intervals = append(intervals, [2]time.Time{start, end})
		}
	}
	return intervals
}

// getFreeSlots devuelve los horarios libres de un empleado para un día concreto,
// dividiendo el día en bloques de la duración real del servicio.
func getFreeSlots(ctx context.Context, negocioID, empID string, day time.Time, durationMinutes int) ([]string, error) {
	svc, emp, err := calendarServiceForEmployee(ctx, negocioID, empID)

	// Usar la zona horaria del negocio, NO la del servidor local
	loc := shopLocation(ctx, negocioID)

	// Determine the shift intervals: use per-employee schedule if available,
	// otherwise fall back to the business-level workDayRange.
	var shiftIntervals [][2]time.Time
	hasEmployeeSchedule := emp != nil && emp.Horario != nil
	if hasEmployeeSchedule {
		if dia := employeeDayHorario(emp.Horario, day.Weekday()); dia != nil {
			shiftIntervals = splitShiftIntervals(ctx, negocioID, dia, day)
		}
	}
	// Only fall back to business hours if the employee has NO schedule configured.
	// If they have a schedule but the day is inactive, return empty slots.
	if !hasEmployeeSchedule && len(shiftIntervals) == 0 {
		startDay, endDay := workDayRange(ctx, negocioID, day)
		shiftIntervals = [][2]time.Time{{startDay, endDay}}
	}

	var slots []string
	slotDuration := time.Duration(durationMinutes) * time.Minute

	// Límite configurable: días máximos en el futuro para reservar.
	now := time.Now()
	maxBookingTime := now.Add(time.Duration(negocioBookingWindow(ctx, negocioID)) * 24 * time.Hour)

	// Antelación mínima: no se ofrecen slots con menos aviso del configurado.
	earliest := now.Add(time.Duration(negocioMinNotice(ctx, negocioID)) * time.Minute)

	// Collect busy periods from Google Calendar for all shift intervals
	var busyPeriods [][2]time.Time
	if err != nil {
		// Mock mode: no Google Calendar linked. Generate slots within each shift.
		log.Printf("Aviso: %v. Devolviendo slots falsos.", err)
		for _, iv := range shiftIntervals {
			for t := iv[0]; !t.Add(slotDuration).After(iv[1]); t = t.Add(slotDuration) {
				if t.After(earliest) && t.Before(maxBookingTime) {
					slots = append(slots, t.Format("15:04"))
				}
				if len(slots) >= 12 {
					break
				}
			}
			if len(slots) >= 12 {
				break
			}
		}
	} else {
		// Query Google Calendar FreeBusy for the full span of all shifts
		var earliestStart, latestEnd time.Time
		for i, iv := range shiftIntervals {
			if i == 0 || iv[0].Before(earliestStart) {
				earliestStart = iv[0]
			}
			if i == 0 || iv[1].After(latestEnd) {
				latestEnd = iv[1]
			}
		}
		req := &calendar.FreeBusyRequest{
			TimeMin: earliestStart.Format(time.RFC3339),
			TimeMax: latestEnd.Format(time.RFC3339),
			Items:   []*calendar.FreeBusyRequestItem{{Id: emp.CalendarID}},
		}
		result, err := svc.Freebusy.Query(req).Context(ctx).Do()
		if err != nil {
			return nil, err
		}
		for _, cal := range result.Calendars {
			for _, period := range cal.Busy {
				tStart, _ := time.Parse(time.RFC3339, period.Start)
				tEnd, _ := time.Parse(time.RFC3339, period.End)
				busyPeriods = append(busyPeriods, [2]time.Time{tStart, tEnd})
			}
		}

		// Generate candidate slots within each shift interval
		for _, iv := range shiftIntervals {
			currentTime := iv[0]
			for currentTime.Before(iv[1]) {
				slotEnd := currentTime.Add(slotDuration)
				if slotEnd.After(iv[1]) {
					break
				}
				free := true
				for _, bp := range busyPeriods {
					if currentTime.Before(bp[1]) && slotEnd.After(bp[0]) {
						free = false
						break
					}
				}
				if free && currentTime.After(earliest) && currentTime.Before(maxBookingTime) {
					slots = append(slots, currentTime.Format("15:04"))
				}
				currentTime = currentTime.Add(slotDuration)
			}
		}
	}

	// Excluir los horarios ya reservados en Firestore (fuente de verdad local).
	// Esto protege contra la doble reserva del mismo slot aunque el empleado no
	// tenga Google Calendar vinculado (modo mock) o hay latencia en el freebusy.
	var bookStart, bookEnd time.Time
	if len(shiftIntervals) > 0 {
		bookStart = shiftIntervals[0][0]
		bookEnd = shiftIntervals[0][1]
		for _, iv := range shiftIntervals[1:] {
			if iv[0].Before(bookStart) {
				bookStart = iv[0]
			}
			if iv[1].After(bookEnd) {
				bookEnd = iv[1]
			}
		}
	} else {
		bookStart, bookEnd = day, day.Add(24*time.Hour)
	}
	booked := firestoreBookedIntervals(ctx, negocioID, empID, bookStart, bookEnd)
	slotDur := time.Duration(durationMinutes) * time.Minute
	filtered := make([]string, 0)
	for _, s := range slots {
		t, _ := time.Parse("15:04", s)
		candStart := time.Date(day.Year(), day.Month(), day.Day(), t.Hour(), t.Minute(), 0, 0, loc)
		candEnd := candStart.Add(slotDur)
		conflict := false
		for _, iv := range booked {
			if candStart.Before(iv[1]) && iv[0].Before(candEnd) {
				conflict = true
				break
			}
		}
		if !conflict {
			filtered = append(filtered, s)
		}
	}

	return filtered, nil
}

// firestoreBookedIntervals devuelve los intervalos [inicio, fin) ya reservados
// consultando la colección reservas usando índices compuestos hiper-rápidos.
func firestoreBookedIntervals(ctx context.Context, negocioID, empID string, startDay, endDay time.Time) [][2]time.Time {
	docs, err := firestoreClient.Collection("reservas").
		Where("negocio_id", "==", negocioID).
		Where("emp_id", "==", empID).
		Where("date_time", ">=", startDay).
		Where("date_time", "<", endDay).
		Documents(ctx).GetAll()

	if err != nil {
		log.Printf("Aviso: no se pudieron cargar reservas para calcular slots de %s: %v", negocioID, err)
		return nil
	}

	var intervals [][2]time.Time
	for _, d := range docs {
		if d.Data()["cancelled"] == true {
			continue
		}
		var b Booking
		d.DataTo(&b)

		dur := time.Duration(b.DurationMinute) * time.Minute
		if dur <= 0 {
			dur = 60 * time.Minute
		}
		start := b.DateTime
		end := start.Add(dur)
		intervals = append(intervals, [2]time.Time{start, end})
	}
	return intervals
}

// hasBookingOnDate verifica si el cliente ya alcanzó el límite familiar/anti-spam
// de 3 citas para el mismo día natural, utilizando índices compuestos hiper-rápidos.
func hasBookingOnDate(ctx context.Context, negocioID, phone string, requested time.Time) bool {
	if phone == "" {
		return false
	}
	loc := shopLocation(ctx, negocioID)
	startOfDay := time.Date(requested.In(loc).Year(), requested.In(loc).Month(), requested.In(loc).Day(), 0, 0, 0, 0, loc)
	endOfDay := startOfDay.Add(24 * time.Hour)

	count := 0
	for _, key := range phoneQueryKeys(phone) {
		docs, err := firestoreClient.Collection("reservas").
			Where("user_phone", "==", key).
			Where("negocio_id", "==", negocioID).
			Where("date_time", ">=", startOfDay).
			Where("date_time", "<", endOfDay).
			Documents(ctx).GetAll()

		if err != nil {
			log.Printf("Aviso: error verificando reserva del día del cliente: %v", err)
			continue
		}
		for _, d := range docs {
			// Excluir canceladas y no-show del conteo
			cancelled := d.Data()["cancelled"]
			noShow := d.Data()["no_show"]
			if cancelled == true || noShow == true {
				continue
			}
			count++
		}
	}
	return count >= negocioMaxBookings(ctx, negocioID)
}

// isSlotAvailable verifica si un slot horario exacto sigue libre en Google Calendar.
// Retorna true si está disponible (o si hay mock/no-OAuth, para no bloquear el MVP).
func isSlotAvailable(ctx context.Context, negocioID, empID string, slotStart time.Time) bool {
	svc, emp, err := calendarServiceForEmployee(ctx, negocioID, empID)
	if err != nil {
		// Sin OAuth configurado: no podemos verificar, asumimos disponible (mock mode)
		log.Printf("Aviso: %v. No se puede verificar disponibilidad, asumiendo libre.", err)
		return true
	}

	slotEnd := slotStart.Add(1 * time.Hour)

	req := &calendar.FreeBusyRequest{
		TimeMin: slotStart.Format(time.RFC3339),
		TimeMax: slotEnd.Format(time.RFC3339),
		Items:   []*calendar.FreeBusyRequestItem{{Id: emp.CalendarID}},
	}
	result, err := svc.Freebusy.Query(req).Context(ctx).Do()
	if err != nil {
		log.Printf("Aviso: error verificando disponibilidad: %v. Asumiendo libre.", err)
		return true
	}

	for _, cal := range result.Calendars {
		if len(cal.Busy) > 0 {
			return false // Hay al menos un evento ocupando este slot
		}
	}
	return true
}

// createCalendarEvent crea un evento en Google Calendar y devuelve su ID.
// El evento lleva todos los detalles de la cita (cliente, teléfono, local,
// notas) y recordatorios automáticos de 1 día y 1 hora antes.
func createCalendarEvent(ctx context.Context, negocioID, empID, serviceName string, durationMinutes int, start time.Time, notes, clientName, clientPhone, shopAddress string) string {
	svc, emp, err := calendarServiceForEmployee(ctx, negocioID, empID)
	if err != nil {
		log.Printf("Aviso: %v. Generando mock event ID.", err)
		return "mock_event_123"
	}

	// Usar la duración dinámica en lugar de 1 hora fija
	end := start.Add(time.Duration(durationMinutes) * time.Minute)

	// Etiquetar el evento con la zona horaria del negocio
	tzString := getShopTimeZone(ctx, negocioID)

	summary := fmt.Sprintf("Cita - %s", serviceName)
	description := "Agendado automáticamente vía Turnobot Web" + firstLinesSuffix(notes)
	if clientName != "" || clientPhone != "" {
		description += "\n" + formatBookingDescription(clientName, clientPhone)
	}

	evt := &calendar.Event{
		Summary:     summary,
		Description: description,
		Start: &calendar.EventDateTime{
			DateTime: start.Format(time.RFC3339),
			TimeZone: tzString,
		},
		End: &calendar.EventDateTime{
			DateTime: end.Format(time.RFC3339),
			TimeZone: tzString,
		},
		Location:  shopAddress,
		Reminders: remindersConfig(ctx, negocioID),
	}
	created, err := svc.Events.Insert(emp.CalendarID, evt).Context(ctx).Do()
	if err != nil {
		log.Printf("Error creando evento en Calendar: %v", err)
		return ""
	}
	return created.Id
}

// formatBookingDescription devuelve una descripción estructurada de la cita.
func formatBookingDescription(clientName, clientPhone string) string {
	var lines []string
	if clientName != "" {
		lines = append(lines, "Cliente: "+clientName)
	}
	if clientPhone != "" {
		lines = append(lines, "Teléfono: "+clientPhone)
	}
	return strings.Join(lines, "\n")
}

// firstLinesSuffix agrega las notas del cliente a la descripción del evento
// (máx 200 caracteres para no saturar el calendario).
func firstLinesSuffix(notes string) string {
	n := strings.TrimSpace(notes)
	if n == "" {
		return ""
	}
	if len(n) > 200 {
		n = n[:200] + "…"
	}
	return "\nNotas del cliente: " + n
}

// ---------------------------------------------------------------------------
// Google OAuth (Vincular Google Calendar por Empleado)
// ---------------------------------------------------------------------------

// GET /auth/google/login?negocio_id=barberia-vip&emp_id=emp_alejandro
func googleLoginHandler(w http.ResponseWriter, r *http.Request) {
	negocioID := r.URL.Query().Get("negocio_id")
	empID := r.URL.Query().Get("emp_id")

	if negocioID == "" || empID == "" {
		http.Error(w, "Faltan parámetros: negocio_id y emp_id son requeridos", http.StatusBadRequest)
		return
	}

	// Usamos el 'state' para recordar a qué empleado y negocio pertenece este login
	state := fmt.Sprintf("%s|%s", negocioID, empID)

	// AccessTypeOffline pide el refresh_token. ApprovalForce obliga a mostrar la pantalla
	// de consentimiento para asegurarnos de que Google siempre nos dé el refresh_token.
	url := googleOauthCfg.AuthCodeURL(
		state,
		oauth2.AccessTypeOffline,
		oauth2.ApprovalForce,
		oauth2.SetAuthURLParam("prompt", "consent"),
	)

	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

// GET /auth/google/callback
func googleCallbackHandler(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()
	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")

	if code == "" || state == "" {
		http.Error(w, "Parámetros de autorización inválidos o cancelados", http.StatusBadRequest)
		return
	}

	// Recuperar el negocioID y empID del state
	parts := strings.Split(state, "|")
	if len(parts) != 2 {
		http.Error(w, "State malformado", http.StatusBadRequest)
		return
	}
	negocioID, empID := parts[0], parts[1]

	// Intercambiar el código por los tokens (access_token y refresh_token)
	token, err := googleOauthCfg.Exchange(ctx, code)
	if err != nil {
		log.Printf("Error intercambiando token OAuth: %v", err)
		http.Error(w, "Error de autenticación con Google", http.StatusInternalServerError)
		return
	}

	// Preparar actualización en Firestore para este empleado específico
	updates := map[string]interface{}{
		"calendar_id": "primary", // Usaremos el calendario principal de su cuenta
		"updated_at":  time.Now(),
	}

	// Google solo devuelve el RefreshToken en el primer login o si forzamos el prompt
	if token.RefreshToken != "" {
		updates["refresh_token"] = token.RefreshToken
	}

	_, err = firestoreClient.Collection("negocios").Doc(negocioID).Collection("empleados").Doc(empID).Set(ctx, updates, firestore.MergeAll)

	if err != nil {
		log.Printf("Error guardando token en Firestore para %s/%s: %v", negocioID, empID, err)
		http.Error(w, "Error guardando configuración", http.StatusInternalServerError)
		return
	}

	// Frontend URL para redirigir al barbero de vuelta a su panel (Dashboard)
	frontendURL := os.Getenv("FRONTEND_URL")
	if frontendURL == "" {
		frontendURL = "http://localhost:5173"
	}

	// NUEVO: Asegurarnos de limpiar barras finales y apuntar a la ruta /admin
	adminURL := strings.TrimRight(frontendURL, "/") + "/admin"

	// Renderizar pantalla de éxito y redirigir
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	html := fmt.Sprintf(`
		<div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
			<h2 style="color: #4CAF50;">✅ ¡Google Calendar vinculado con éxito!</h2>
			<p>Ya puedes empezar a recibir reservas.</p>
			<p style="color: gray; font-size: 14px;">Redirigiendo a tu panel...</p>
			<script>setTimeout(() => window.location.href='%s', 3000)</script>
		</div>
	`, adminURL)
	fmt.Fprint(w, html)
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Employee Login & Dashboard
// ---------------------------------------------------------------------------

// employeeTokenSigningKey firma los tokens de sesión de empleados.
// VIENE DE ENV (EMPLOYEE_TOKEN_KEY): hardcodearla permitiría forjar sesiones
// a cualquiera que lea el repo. Se valida en main (fail-closed).
var employeeTokenKey []byte

// signEmployeeToken genera un token HMAC-SHA256 con expiración de 12 horas.
func signEmployeeToken(slug, empID string) string {
	exp := time.Now().Add(12 * time.Hour).Unix()
	payload := fmt.Sprintf("%s|%s|%d", slug, empID, exp)
	mac := hmac.New(sha256.New, employeeTokenKey)
	mac.Write([]byte(payload))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + sig
}

// verifyEmployeeToken valida el token y retorna slug, empID o error.
func verifyEmployeeToken(token string) (string, string, error) {
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return "", "", fmt.Errorf("token inválido")
	}
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", "", fmt.Errorf("token inválido")
	}
	sigBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", "", fmt.Errorf("token inválido")
	}
	mac := hmac.New(sha256.New, employeeTokenKey)
	mac.Write(payloadBytes)
	if !hmac.Equal(sigBytes, mac.Sum(nil)) {
		return "", "", fmt.Errorf("token inválido")
	}
	payload := string(payloadBytes)
	parts2 := strings.SplitN(payload, "|", 3)
	if len(parts2) != 3 {
		return "", "", fmt.Errorf("token inválido")
	}
	exp, _ := strconv.ParseInt(parts2[2], 10, 64)
	if time.Now().Unix() > exp {
		return "", "", fmt.Errorf("token expirado")
	}
	return parts2[0], parts2[1], nil
}

// pinGuard limita fuerza bruta al PIN: 5 fallos => bloqueo 15 min por
// (negocio, empleado). En memoria por instancia (igual que los rate limiters);
// el bookingLimiter (10 POST/min/IP) ya frena el barrido masivo.
var pinGuard = struct {
	sync.Mutex
	fallos map[string]int
	hasta  map[string]time.Time
}{fallos: map[string]int{}, hasta: map[string]time.Time{}}

const pinMaxFallos = 5
const pinBloqueo = 15 * time.Minute

func pinBloqueado(key string) bool {
	pinGuard.Lock()
	defer pinGuard.Unlock()
	if time.Now().Before(pinGuard.hasta[key]) {
		return true
	}
	return false
}

// pinFallo registra un intento fallido y retorna el conteo. Al llegar al
// máximo activa el bloqueo (nunca se loguea el PIN).
func pinFallo(key string) int {
	pinGuard.Lock()
	defer pinGuard.Unlock()
	pinGuard.fallos[key]++
	n := pinGuard.fallos[key]
	if n >= pinMaxFallos {
		pinGuard.hasta[key] = time.Now().Add(pinBloqueo)
		pinGuard.fallos[key] = 0
	}
	return n
}

func pinReset(key string) {
	pinGuard.Lock()
	defer pinGuard.Unlock()
	delete(pinGuard.fallos, key)
	delete(pinGuard.hasta, key)
}

// POST /api/v1/b/{slug}/employee-login
func employeeLoginHandler(w http.ResponseWriter, r *http.Request, slug string) {
	var req struct {
		EmpID string `json:"emp_id"`
		Pin   string `json:"pin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.EmpID == "" || req.Pin == "" {
		http.Error(w, "Datos inválidos", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	doc, err := firestoreClient.Collection("negocios").Doc(slug).Collection("empleados").Doc(req.EmpID).Get(ctx)
	if err != nil {
		http.Error(w, "Empleado no encontrado", http.StatusNotFound)
		return
	}

	var emp Employee
	doc.DataTo(&emp)

	if emp.LoginPIN == "" {
		http.Error(w, "Este empleado no tiene PIN configurado", http.StatusForbidden)
		return
	}

	// Lockout anti-fuerza-bruta (además del rate limit 10/min/IP).
	pinKey := slug + "|" + req.EmpID
	if pinBloqueado(pinKey) {
		log.Printf("Login empleado bloqueado por intentos: %s", pinKey)
		http.Error(w, "Demasiados intentos. Espera 15 minutos.", http.StatusTooManyRequests)
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(emp.LoginPIN), []byte(req.Pin)); err != nil {
		n := pinFallo(pinKey)
		log.Printf("PIN incorrecto empleado %s (intento %d/5)", pinKey, n)
		http.Error(w, "PIN incorrecto", http.StatusUnauthorized)
		return
	}
	pinReset(pinKey)

	token := signEmployeeToken(slug, req.EmpID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"token":  token,
		"emp_id": req.EmpID,
		"name":   emp.Name,
	})
}

// GET /api/v1/b/{slug}/employee/{empId}/citas
func employeeCitasHandler(w http.ResponseWriter, r *http.Request, slug, empID string) {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	tokenSlug, tokenEmpID, err := verifyEmployeeToken(token)
	if err != nil || tokenSlug != slug || tokenEmpID != empID {
		http.Error(w, "No autorizado", http.StatusUnauthorized)
		return
	}

	ctx := r.Context()
	loc, _ := time.LoadLocation("America/Bogota")

	q := firestoreClient.Collection("reservas").
		Where("negocio_id", "==", slug).
		Where("emp_id", "==", empID).
		OrderBy("date_time", firestore.Asc)

	docs, err := q.Documents(ctx).GetAll()
	if err != nil {
		http.Error(w, "Error consultando citas", http.StatusInternalServerError)
		return
	}

	type empCitaJSON struct {
		ID        string `json:"id"`
		Servicio  string `json:"servicio"`
		Cliente   string `json:"cliente"`
		Telefono  string `json:"telefono"`
		Precio    int    `json:"precio"`
		Fecha     string `json:"fecha"`
		Hora      string `json:"hora"`
		Iso       string `json:"iso"`
		Notes     string `json:"notes,omitempty"`
		NoShow    bool   `json:"no_show"`
		Cancelled bool   `json:"cancelled"`
	}

	now := time.Now()
	citas := []empCitaJSON{}
	for _, d := range docs {
		var b Booking
		d.DataTo(&b)
		if b.DateTime.Before(now.AddDate(0, 0, -1)) {
			continue
		}
		citas = append(citas, empCitaJSON{
			ID:        d.Ref.ID,
			Servicio:  b.ServiceName,
			Cliente:   b.ClientName,
			Telefono:  b.UserPhone,
			Precio:    b.Price,
			Fecha:     b.DateTime.In(loc).Format("2006-01-02"),
			Hora:      b.DateTime.In(loc).Format("15:04"),
			Iso:       b.DateTime.In(loc).Format(time.RFC3339),
			Notes:     b.Notes,
			NoShow:    b.NoShow,
			Cancelled: d.Data()["cancelled"] == true,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(citas)
}

// POST /api/v1/b/{slug}/empleados/{empleadoID}/pin
func setEmployeePinHandler(w http.ResponseWriter, r *http.Request, slug, empID string) {
	if !isOwnerRequest(r, slug) {
		http.Error(w, "No autorizado", http.StatusUnauthorized)
		return
	}

	var req struct {
		Pin string `json:"pin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Pin) < 4 || len(req.Pin) > 6 {
		http.Error(w, "PIN debe tener 4-6 dígitos", http.StatusBadRequest)
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Pin), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "Error procesando PIN", http.StatusInternalServerError)
		return
	}

	ctx := r.Context()
	_, err = firestoreClient.Collection("negocios").Doc(slug).Collection("empleados").Doc(empID).Update(ctx, []firestore.Update{
		{Path: "login_pin", Value: string(hash)},
	})
	if err != nil {
		http.Error(w, "Error guardando PIN", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "PIN actualizado",
	})
}

// POST /api/v1/b/{slug}/employee/{empId}/register-push-token
func employeeRegisterPushTokenHandler(w http.ResponseWriter, r *http.Request, slug, empID string) {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	tokenSlug, tokenEmpID, err := verifyEmployeeToken(token)
	if err != nil || tokenSlug != slug || tokenEmpID != empID {
		http.Error(w, "No autorizado", http.StatusUnauthorized)
		return
	}

	var req registerPushTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Token) == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "token_requerido",
			"message": "El campo token es requerido",
		})
		return
	}
	req.Token = strings.TrimSpace(req.Token)
	if len(req.Token) > 512 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "token_invalido",
			"message": "El token parece inválido",
		})
		return
	}

	ctx := r.Context()
	_, err = firestoreClient.Collection("negocios").Doc(slug).Collection("empleados").Doc(empID).Update(ctx, []firestore.Update{
		{Path: "push_token", Value: req.Token},
	})
	if err != nil {
		log.Printf("Error guardando push token para empleado %s/%s: %v", slug, empID, err)
		http.Error(w, "Error guardando token", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Token push registrado",
	})
}

// DELETE /api/v1/b/{slug}/employee/{empId}/push-token
// Baja de push del empleado: deja de recibir avisos en su dispositivo.
func employeeUnregisterPushTokenHandler(w http.ResponseWriter, r *http.Request, slug, empID string) {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	tokenSlug, tokenEmpID, err := verifyEmployeeToken(token)
	if err != nil || tokenSlug != slug || tokenEmpID != empID {
		http.Error(w, "No autorizado", http.StatusUnauthorized)
		return
	}

	ctx := r.Context()
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Collection("empleados").Doc(empID).Update(ctx, []firestore.Update{
		{Path: "push_token", Value: ""},
	}); err != nil {
		log.Printf("Error borrando push token empleado %s/%s: %v", slug, empID, err)
		http.Error(w, "Error eliminando token", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Notificaciones desactivadas",
	})
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	status := "ok"
	statusCode := http.StatusOK

	// Verificar Firestore
	_, err := firestoreClient.Collection("_health").Doc("ping").Get(ctx)
	if err != nil && !strings.Contains(err.Error(), "not found") {
		status = "degraded"
		statusCode = http.StatusServiceUnavailable
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    status,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"version":   "1.0.0",
	})
}

// apiBookingLimiter aplica rate limiting más estricto a endpoints de escritura
func apiBookingLimiter(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			rateLimitMiddleware(bookingLimiter, next)(w, r)
			return
		}
		next(w, r)
	}
}
