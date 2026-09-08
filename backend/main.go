package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"

	"cloud.google.com/go/firestore"
	"github.com/nyaruka/phonenumbers"
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
)

// ---------------------------------------------------------------------------
// Data Models (optimizados para JSON y Firestore)
// ---------------------------------------------------------------------------

// Negocio (business) document stored in Firestore.
type Negocio struct {
	ID           string     `json:"id"`
	Name         string     `firestore:"name" json:"name"`
	OwnerUID     string     `firestore:"owner_uid" json:"-"`
	RefreshToken string     `firestore:"refresh_token" json:"-"` // Oculto en JSON
	CalendarID   string     `firestore:"calendar_id" json:"-"`   // Oculto en JSON
	Whatsapp     string     `firestore:"whatsapp" json:"whatsapp"`
	Direccion    string     `firestore:"direccion" json:"direccion"`
	Horario      string     `firestore:"horario" json:"horario"`
	Telefono     string     `firestore:"telefono" json:"telefono"`
	TimeZone     string     `firestore:"timezone" json:"timezone"`
	OpenTime     string     `firestore:"open_time" json:"open_time"`
	CloseTime    string     `firestore:"close_time" json:"close_time"`
	Servicios    []Service  `json:"servicios"`
	Empleados    []Employee `json:"empleados"`
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
}

// Booking is a confirmed appointment.
type Booking struct {
	NegocioID      string    `firestore:"negocio_id"`
	EmpID          string    `firestore:"emp_id"`
	UserPhone      string    `firestore:"user_phone"`
	ClientName     string    `firestore:"client_name"`
	ServiceName    string    `firestore:"service_name"`
	DurationMinute int       `firestore:"duration_minutes,omitempty"`
	Price          int       `firestore:"price"`
	DateTime       time.Time `firestore:"date_time"`
	CalendarEvt    string    `firestore:"calendar_event_id,omitempty"`
	CreatedAt      time.Time `firestore:"created_at"`
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

	// 1b. Firebase Auth para verificar el token del dueño (operaciones de admin)
	fbApp, err := firebase.NewApp(ctx, &firebase.Config{ProjectID: projectID})
	if err != nil {
		log.Fatalf("Error inicializando Firebase App: %v", err)
	}
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

	// 3. Rutas HTTP
	http.HandleFunc("/api/v1/b/", corsMiddleware(apiRouter))
	http.HandleFunc("/auth/google/login", googleLoginHandler)
	http.HandleFunc("/auth/google/callback", googleCallbackHandler)
	http.HandleFunc("/health", healthHandler)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("Servidor API REST escuchando en el puerto %s", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Error iniciando servidor: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Middleware y enrutador
// ---------------------------------------------------------------------------

// corsMiddleware permite que el frontend web consulte esta API desde otro dominio.
func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next(w, r)
	}
}

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

	if len(parts) == 3 && parts[1] == "servicios" && r.Method == http.MethodDelete {
		deleteServicioHandler(w, r, slug, parts[2])
		return
	}

	if len(parts) == 3 && parts[1] == "empleados" && r.Method == http.MethodDelete {
		deleteEmpleadoHandler(w, r, slug, parts[2])
		return
	}

	http.Error(w, "Ruta no encontrada", http.StatusNotFound)
}

// ---------------------------------------------------------------------------
// Endpoints API REST
// ---------------------------------------------------------------------------

// GET /api/v1/b/{slug} -> datos del negocio, servicios y empleados
func getNegocioHandler(w http.ResponseWriter, r *http.Request, slug string) {
	ctx := context.Background()

	doc, err := firestoreClient.Collection("negocios").Doc(slug).Get(ctx)
	if err != nil {
		http.Error(w, "Negocio no encontrado", http.StatusNotFound)
		return
	}

	var negocio Negocio
	doc.DataTo(&negocio)
	negocio.ID = doc.Ref.ID

	// Asegurar que los arrays nunca sean null en el JSON (la UI hace .map
	// directo; un negocio sin servicios/empleados debe entregar []).
	negocio.Servicios = []Service{}
	negocio.Empleados = []Employee{}

	svcsDocs, err := firestoreClient.Collection("negocios").Doc(slug).Collection("servicios").Documents(ctx).GetAll()
	if err != nil {
		log.Printf("Error cargando servicios de %s: %v", slug, err)
	}
	for _, d := range svcsDocs {
		var svc Service
		d.DataTo(&svc)
		svc.ID = d.Ref.ID
		negocio.Servicios = append(negocio.Servicios, svc)
	}

	empsDocs, err := firestoreClient.Collection("negocios").Doc(slug).Collection("empleados").Documents(ctx).GetAll()
	if err != nil {
		log.Printf("Error cargando empleados de %s: %v", slug, err)
	}
	for _, d := range empsDocs {
		var emp Employee
		d.DataTo(&emp)
		emp.ID = d.Ref.ID
		negocio.Empleados = append(negocio.Empleados, emp)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(negocio)
}

// GET /api/v1/b/{slug}/slots?emp_id=XYZ&servicio_id=ABC&fecha=YYYY-MM-DD
func getSlotsHandler(w http.ResponseWriter, r *http.Request, slug string) {
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

	// Agrega la lectura del servicio para calcular saltos según su duración real
	_, duration, _ := resolveService(r.Context(), slug, servicioID)

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

	// 0. Límite estricto: un cliente (identificado por su teléfono) solo puede
	// tener UNA cita por día en esta barbería. Si ya tiene una reserva para el
	// mismo día natural, se rechaza la petición antes de tocar Calendar/Firestore.
	if hasBookingOnDate(ctx, slug, req.ClienteTelefono, eventDateTime) {
		log.Printf("Límite diario de %s: ya tiene cita el %s (%s) en %s", req.ClienteTelefono, req.Fecha, req.Hora, slug)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "max_per_day",
			"message": "Ya tienes un turno agendado para este día. Si necesitas reservar para un amigo o familiar, por favor comunícate directamente con la barbería.",
		})
		return
	}

	// Resolver el nombre y la duración real del servicio a partir de su ID
	serviceName, duration, precioServicio := resolveService(ctx, slug, req.ServicioID)

	// 1. Verificación estricta de disponibilidad en el último milisegundo.
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

	// 2. Verificar que el cliente NO tenga ya una cita que se superponga con este horario.
	// Un cliente no puede estar en dos citas al mismo tiempo (aunque sea con barberos diferentes).
	if hasCustomerOverlap(ctx, slug, req.ClienteTelefono, eventDateTime) {
		log.Printf("Doble reserva del cliente %s: %s %s en %s", req.ClienteTelefono, req.Fecha, req.Hora, slug)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "double_booking",
			"message": "Ya tienes una cita agendada a esta hora. Por favor elige otro horario.",
		})
		return
	}

	// Crear evento en Google Calendar (o mock si no hay OAuth configurado)
	// con la duración real del servicio.
	eventID := createCalendarEvent(ctx, slug, req.EmpleadoID, serviceName, duration, eventDateTime)

	// Guardar la reserva en Firestore
	_, _, err = firestoreClient.Collection("reservas").Add(ctx, Booking{
		NegocioID:      slug,
		EmpID:          req.EmpleadoID,
		UserPhone:      req.ClienteTelefono,
		ClientName:     req.ClienteNombre,
		ServiceName:    serviceName,
		DurationMinute: duration,
		Price:          precioServicio,
		DateTime:       eventDateTime,
		CalendarEvt:    eventID,
		CreatedAt:      time.Now(),
	})
	if err != nil {
		http.Error(w, "Error guardando la reserva", http.StatusInternalServerError)
		return
	}

	// CRM: actualizar (upsert) el cliente en el directorio del negocio
	upsertCliente(ctx, slug, req.ClienteTelefono, req.ClienteNombre, precioServicio, eventDateTime)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"message":  "Cita agendada exitosamente",
		"event_id": eventID,
	})
}

// GET /api/v1/b/{slug}/citas?telefono=3001234567 -> citas activas del cliente
func listCitasHandler(w http.ResponseWriter, r *http.Request, slug string) {
	telefono := r.URL.Query().Get("telefono")
	if telefono == "" {
		http.Error(w, "Falta parámetro telefono", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	// Las reservas se almacenan en E.164 (+573001234567), pero se buscan
	// también por el formato nacional en dígitos para cubrir reservas creadas
	// antes de la normalización (user_phone = "3001234567").
	docsByRef := map[string]*firestore.DocumentSnapshot{}
	for _, key := range phoneQueryKeys(telefono) {
		keyDocs, err := firestoreClient.Collection("reservas").
			Where("user_phone", "==", key).
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
	docs := make([]*firestore.DocumentSnapshot, 0, len(docsByRef))
	for _, d := range docsByRef {
		docs = append(docs, d)
	}

	now := time.Now()
	var citasPendientes []*firestore.DocumentSnapshot
	for _, d := range docs {
		var b Booking
		d.DataTo(&b)
		if b.NegocioID == slug && b.DateTime.After(now) {
			citasPendientes = append(citasPendientes, d)
		}
	}
	sort.Slice(citasPendientes, func(i, j int) bool {
		var bi, bj Booking
		citasPendientes[i].DataTo(&bi)
		citasPendientes[j].DataTo(&bj)
		return bi.DateTime.Before(bj.DateTime)
	})

	type citaJSON struct {
		ID         string `json:"id"`
		Servicio   string `json:"servicio"`
		Fecha      string `json:"fecha"`
		Hora       string `json:"hora"`
		EmpID      string `json:"emp_id"`
		EmpName    string `json:"emp_name"`
		Cancelable bool   `json:"cancelable"`
		Iso        string `json:"iso"`
	}

	// Firestore devuelve los timestamps en UTC; se formatean en la zona horaria
	// del negocio (configurada en el documento, fallback America/Bogota) para
	// que la hora mostrada coincida con la elegida.
	loc := shopLocation(ctx, slug)

	// Mapa empID -> nombre para mostrar el profesional asignado
	empNames := map[string]string{}
	empsDocs, _ := firestoreClient.Collection("negocios").Doc(slug).Collection("empleados").Documents(ctx).GetAll()
	for _, d := range empsDocs {
		var emp Employee
		d.DataTo(&emp)
		empNames[d.Ref.ID] = emp.Name
	}

	citas := []citaJSON{}
	for _, d := range citasPendientes {
		var b Booking
		d.DataTo(&b)
		citas = append(citas, citaJSON{
			ID:         d.Ref.ID,
			Servicio:   b.ServiceName,
			Fecha:      b.DateTime.In(loc).Format("2006-01-02"),
			Hora:       b.DateTime.In(loc).Format("15:04"),
			EmpID:      b.EmpID,
			EmpName:    empNames[b.EmpID],
			Cancelable: b.DateTime.Sub(now) >= 2*time.Hour,
			Iso:        b.DateTime.In(loc).Format(time.RFC3339),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(citas)
}

// DELETE /api/v1/b/{slug}/citas/{citaID} -> cancela la cita (Firestore + Google Calendar)
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

	// Regla de negocio: un cliente no puede cancelar por Internet cuando faltan
	// menos de 2 horas para el turno. El dueño (token verificado) siempre puede.
	if !isOwnerRequest(r, slug) && b.DateTime.Sub(time.Now()) < 2*time.Hour {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "cancel_window",
			"message": "Ya no puedes cancelar esta cita por Internet (faltan menos de 2 horas). Comunícate directamente con el local.",
		})
		return
	}

	// Borrar el evento de Google Calendar del empleado si existe
	if b.CalendarEvt != "" && b.CalendarEvt != "mock_event_123" {
		deleteCalendarEvent(ctx, slug, b.EmpID, b.CalendarEvt)
	}

	// Borrar la reserva de Firestore
	_, err = docRef.Delete(ctx)
	if err != nil {
		log.Printf("Error cancelando cita %s: %v", citaID, err)
		http.Error(w, "Error cancelando la cita", http.StatusInternalServerError)
		return
	}

	// CRM: reflejar la cancelación en el directorio de clientes
	decrementCliente(ctx, slug, b.UserPhone, b.Price)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Cita cancelada exitosamente",
	})
}

// clienteDocID genera el ID estable del documento de cliente a partir del
// negocio y el teléfono (E.164). Así un mismo cliente puede existir en varias
// tiendas sin colisionar, y el upsert siempre apunta al mismo documento.
func clienteDocID(slug, phone string) string {
	return slug + "__" + phone
}

// upsertCliente escribe (o actualiza) el cliente en la colección clientes del
// negocio cada vez que agenda una cita. Invalida las reglas de Firestore
// porque el backend usa el Admin SDK (service account).
func upsertCliente(ctx context.Context, slug, phone, name string, price int, dateTime time.Time) {
	if slug == "" || phone == "" {
		return
	}
	ref := firestoreClient.Collection("clientes").Doc(clienteDocID(slug, phone))
	_, err := ref.Set(ctx, map[string]interface{}{
		"negocio_id":    slug,
		"cliente_phone": phone,
		"client_name":   name,
		"visits":        firestore.Increment(1),
		"total_spent":   firestore.Increment(price),
		"last_seen":     dateTime,                      // Fecha/Hora exacta del turno agendado
		"last_date_str": dateTime.Format("2006-01-02"), // Respaldo legible en zona del negocio
		"updated_at":    time.Now(),
	}, firestore.MergeAll)
	if err != nil {
		log.Printf("Aviso: no se pudo actualizar al cliente %s en %s: %v", phone, slug, err)
	}
}

// decrementCliente refleja una cancelación en el directorio de clientes
// (resta una visita y el valor del servicio cancelado).
func decrementCliente(ctx context.Context, slug, phone string, price int) {
	if slug == "" || phone == "" {
		return
	}
	ref := firestoreClient.Collection("clientes").Doc(clienteDocID(slug, phone))
	_, err := ref.Update(ctx, []firestore.Update{
		{Path: "visits", Value: firestore.Increment(-1)},
		{Path: "total_spent", Value: firestore.Increment(-price)},
		{Path: "updated_at", Value: time.Now()},
	})
	if err != nil {
		log.Printf("Aviso: no se pudo actualizar al cliente %s en %s: %v", phone, slug, err)
	}
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
	for _, ref := range affected {
		batch.Delete(ref)
	}
	if _, err := batch.Commit(ctx); err != nil {
		log.Printf("Error borrando servicio %s en cascada: %v", servicioID, err)
		http.Error(w, "Error eliminando el servicio", http.StatusInternalServerError)
		return
	}

	deleteCitasCalendarEvents(ctx, slug, affected)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":        true,
		"message":        "Servicio eliminado",
		"citas_borradas": deleted,
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
	for _, ref := range affected {
		batch.Delete(ref)
	}
	if _, err := batch.Commit(ctx); err != nil {
		log.Printf("Error borrando empleado %s en cascada: %v", empID, err)
		http.Error(w, "Error eliminando el profesional", http.StatusInternalServerError)
		return
	}

	deleteCitasCalendarEvents(ctx, slug, affected)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":        true,
		"message":        "Profesional eliminado",
		"citas_borradas": deleted,
	})
}

// cascadeDeleteCitas encuentra las reservas futuras que deben eliminarse en
// cascada (por empleado y/o por nombre de servicio) y devuelve las citas
// afectadas con su evento de calendario y sus referencias para el Batch Write.
func cascadeDeleteCitas(ctx context.Context, slug, empID, serviceName string) (int, []*firestore.DocumentRef) {
	docs, err := firestoreClient.Collection("reservas").
		Where("negocio_id", "==", slug).
		Documents(ctx).GetAll()
	if err != nil {
		log.Printf("Aviso: no se pudo consultar reservas para cascada de %s: %v", slug, err)
		return 0, nil
	}

	now := time.Now()
	var affected []*firestore.DocumentRef
	for _, d := range docs {
		var b Booking
		d.DataTo(&b)
		if !b.DateTime.After(now) {
			continue
		}
		if empID != "" && b.EmpID != empID {
			continue
		}
		if serviceName != "" && b.ServiceName != serviceName {
			continue
		}
		affected = append(affected, d.Ref)
	}
	return len(affected), affected
}

// deleteCitasCalendarEvents libera en Google Calendar todos los eventos de las
// reservas eliminadas. Se invoca después de confirmar el Batch Write.
func deleteCitasCalendarEvents(ctx context.Context, slug string, citas []*firestore.DocumentRef) {
	for _, ref := range citas {
		doc, err := ref.Get(ctx)
		if err != nil {
			continue
		}
		var b Booking
		doc.DataTo(&b)
		if b.CalendarEvt != "" && b.CalendarEvt != "mock_event_123" {
			deleteCalendarEvent(ctx, slug, b.EmpID, b.CalendarEvt)
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
func resolveService(ctx context.Context, slug, servicioID string) (string, int, int) {
	doc, err := firestoreClient.Collection("negocios").Doc(slug).Collection("servicios").Doc(servicioID).Get(ctx)
	if err != nil {
		return servicioID, 60, 0 // Fallback: 60 minutos por defecto
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
	return name, duration, parsePriceVal(svc.Price)
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

	// Collect busy periods from Google Calendar for all shift intervals
	var busyPeriods [][2]time.Time
	if err != nil {
		// Mock mode: no Google Calendar linked. Generate slots within each shift.
		log.Printf("Aviso: %v. Devolviendo slots falsos.", err)
		for _, iv := range shiftIntervals {
			for t := iv[0]; !t.Add(slotDuration).After(iv[1]); t = t.Add(slotDuration) {
				if t.After(time.Now()) {
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
				if free && currentTime.After(time.Now()) {
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
// para un empleado dentro de [startDay, endDay), consultando la colección reservas.
// La duración se usa para calcular el fin del intervalo (default 60 min).
func firestoreBookedIntervals(ctx context.Context, negocioID, empID string, startDay, endDay time.Time) [][2]time.Time {
	docs, err := firestoreClient.Collection("reservas").
		Where("negocio_id", "==", negocioID).
		Documents(ctx).GetAll()
	if err != nil {
		log.Printf("Aviso: no se pudieron cargar reservas para calcular slots de %s: %v", negocioID, err)
		return nil
	}

	var intervals [][2]time.Time
	for _, d := range docs {
		var b Booking
		d.DataTo(&b)
		if b.EmpID != empID {
			continue
		}
		dur := time.Duration(b.DurationMinute) * time.Minute
		if dur <= 0 {
			dur = 60 * time.Minute
		}
		start := b.DateTime
		end := start.Add(dur)
		// Filtrar intervalos que no tocan el día consultado
		if !start.Before(endDay) || !end.After(startDay) {
			continue
		}
		intervals = append(intervals, [2]time.Time{start, end})
	}
	return intervals
}

// hasCustomerOverlap verifica si el cliente ya tiene una cita que se superpone
// con el horario solicitado (mismo negocio, mismo teléfono, hora dentro de ±60 min).
func hasCustomerOverlap(ctx context.Context, negocioID, phone string, requested time.Time) bool {
	if phone == "" {
		return false
	}

	for _, key := range phoneQueryKeys(phone) {
		docs, err := firestoreClient.Collection("reservas").
			Where("user_phone", "==", key).
			Documents(ctx).GetAll()
		if err != nil {
			log.Printf("Aviso: error verificando overlap del cliente: %v", err)
			continue // No bloquear la reserva si hay error de Firestore
		}
		for _, d := range docs {
			var b Booking
			d.DataTo(&b)
			if b.NegocioID != negocioID {
				continue
			}
			// Si la diferencia entre las dos citas es menor a 60 minutos, hay superposición
			diff := b.DateTime.Sub(requested)
			if diff < 0 {
				diff = -diff
			}
			if diff < 60*time.Minute {
				return true
			}
		}
	}
	return false
}

// hasBookingOnDate verifica si el cliente ya tiene UNA reserva (o más) para el
// mismo día natural del negocio. Es el filtro estricto de "una cita por cliente
// al día": se consulta por teléfono y se compara el día en la zona horaria del
// negocio (la fecha puede diferir entre UTC y la localidad del local).
func hasBookingOnDate(ctx context.Context, negocioID, phone string, requested time.Time) bool {
	if phone == "" {
		return false
	}

	loc := shopLocation(ctx, negocioID)
	day := requested.In(loc).Format("2006-01-02")
	for _, key := range phoneQueryKeys(phone) {
		docs, err := firestoreClient.Collection("reservas").
			Where("user_phone", "==", key).
			Documents(ctx).GetAll()
		if err != nil {
			log.Printf("Aviso: error verificando reserva del día del cliente: %v", err)
			continue // No bloquear la reserva si hay error de Firestore
		}
		for _, d := range docs {
			var b Booking
			d.DataTo(&b)
			if b.NegocioID != negocioID {
				continue
			}
			if b.DateTime.In(loc).Format("2006-01-02") == day {
				return true
			}
		}
	}
	return false
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
func createCalendarEvent(ctx context.Context, negocioID, empID, serviceName string, durationMinutes int, start time.Time) string {
	svc, emp, err := calendarServiceForEmployee(ctx, negocioID, empID)
	if err != nil {
		log.Printf("Aviso: %v. Generando mock event ID.", err)
		return "mock_event_123"
	}

	// Usar la duración dinámica en lugar de 1 hora fija
	end := start.Add(time.Duration(durationMinutes) * time.Minute)

	// Etiquetar el evento con la zona horaria del negocio
	tzString := getShopTimeZone(ctx, negocioID)

	evt := &calendar.Event{
		Summary:     fmt.Sprintf("Cita - %s", serviceName),
		Description: "Agendado automáticamente vía Turnobot Web",
		Start: &calendar.EventDateTime{
			DateTime: start.Format(time.RFC3339),
			TimeZone: tzString,
		},
		End: &calendar.EventDateTime{
			DateTime: end.Format(time.RFC3339),
			TimeZone: tzString,
		},
	}
	created, err := svc.Events.Insert(emp.CalendarID, evt).Context(ctx).Do()
	if err != nil {
		log.Printf("Error creando evento en Calendar: %v", err)
		return ""
	}
	return created.Id
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
// Health
// ---------------------------------------------------------------------------

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "Turnobot API REST OK")
}
