package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
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
)

// ---------------------------------------------------------------------------
// Data Models (optimizados para JSON y Firestore)
// ---------------------------------------------------------------------------

// Negocio (business) document stored in Firestore.
type Negocio struct {
	ID           string     `json:"id"`
	Name         string     `firestore:"name" json:"name"`
	RefreshToken string     `firestore:"refresh_token" json:"-"` // Oculto en JSON
	CalendarID   string     `firestore:"calendar_id" json:"-"`   // Oculto en JSON
	Whatsapp     string     `firestore:"whatsapp" json:"whatsapp"`
	Direccion    string     `firestore:"direccion" json:"direccion"`
	Horario      string     `firestore:"horario" json:"horario"`
	Telefono     string     `firestore:"telefono" json:"telefono"`
	Servicios    []Service  `json:"servicios"`
	Empleados    []Employee `json:"empleados"`
}

// Employee sub-document under a negocio.
type Employee struct {
	ID         string `json:"id"`
	Name       string `firestore:"name" json:"name"`
	CalendarID string `firestore:"calendar_id" json:"-"`
	Phone      string `firestore:"phone" json:"-"`
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
	NegocioID   string    `firestore:"negocio_id"`
	EmpID       string    `firestore:"emp_id"`
	UserPhone   string    `firestore:"user_phone"`
	ClientName  string    `firestore:"client_name"`
	ServiceName string    `firestore:"service_name"`
	DateTime    time.Time `firestore:"date_time"`
	CalendarEvt string    `firestore:"calendar_event_id,omitempty"`
	CreatedAt   time.Time `firestore:"created_at"`
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

// GET /api/v1/b/{slug}/slots?emp_id=XYZ&fecha=YYYY-MM-DD
func getSlotsHandler(w http.ResponseWriter, r *http.Request, slug string) {
	empID := r.URL.Query().Get("emp_id")
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

	slots, err := getFreeSlots(r.Context(), slug, empID, parsedDate)
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
	eventDateTime := time.Date(
		parsedDate.Year(), parsedDate.Month(), parsedDate.Day(),
		hour.Hour(), hour.Minute(), 0, 0, bogotaLocation(),
	)

	// 1. Verificación estricta de disponibilidad en el último milisegundo.
	slotsActuales, err := getFreeSlots(ctx, slug, req.EmpleadoID, parsedDate)
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

	// Resolver el nombre real del servicio a partir de su ID
	serviceName := resolveServiceName(ctx, slug, req.ServicioID)

	// Crear evento en Google Calendar (o mock si no hay OAuth configurado)
	eventID := createCalendarEvent(ctx, slug, req.EmpleadoID, serviceName, eventDateTime)

	// Guardar la reserva en Firestore
	_, _, err = firestoreClient.Collection("reservas").Add(ctx, Booking{
		NegocioID:   slug,
		EmpID:       req.EmpleadoID,
		UserPhone:   req.ClienteTelefono,
		ClientName:  req.ClienteNombre,
		ServiceName: serviceName,
		DateTime:    eventDateTime,
		CalendarEvt: eventID,
		CreatedAt:   time.Now(),
	})
	if err != nil {
		http.Error(w, "Error guardando la reserva", http.StatusInternalServerError)
		return
	}

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
	// Consulta por teléfono únicamente (usa el índice automático de un solo campo)
	// y se filtra/ordena en Go para no requerir un índice compuesto en Firestore.
	docs, err := firestoreClient.Collection("reservas").
		Where("user_phone", "==", telefono).
		Documents(ctx).GetAll()
	if err != nil {
		log.Printf("Error consultando citas: %v", err)
		http.Error(w, "Error consultando citas", http.StatusInternalServerError)
		return
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
		ID       string `json:"id"`
		Servicio string `json:"servicio"`
		Fecha    string `json:"fecha"`
		Hora     string `json:"hora"`
		EmpID    string `json:"emp_id"`
		EmpName  string `json:"emp_name"`
	}

	// Firestore devuelve los timestamps en UTC; se formatean en la zona horaria
	// del negocio (America/Bogota) para que la hora mostrada coincida con la elegida.
	loc := bogotaLocation()

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
			ID:       d.Ref.ID,
			Servicio: b.ServiceName,
			Fecha:    b.DateTime.In(loc).Format("2006-01-02"),
			Hora:     b.DateTime.In(loc).Format("15:04"),
			EmpID:    b.EmpID,
			EmpName:  empNames[b.EmpID],
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Cita cancelada exitosamente",
	})
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

// resolveServiceName busca el nombre real del servicio en Firestore a partir de su ID.
func resolveServiceName(ctx context.Context, slug, servicioID string) string {
	doc, err := firestoreClient.Collection("negocios").Doc(slug).Collection("servicios").Doc(servicioID).Get(ctx)
	if err != nil {
		// Fallback: usar el ID enviado por el frontend
		return servicioID
	}
	var svc Service
	doc.DataTo(&svc)
	if svc.Name == "" {
		return servicioID
	}
	return svc.Name
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
		return nil, nil, fmt.Errorf("el empleado no ha vinculado su google calendar")
	}

	token := &oauth2.Token{RefreshToken: emp.RefreshToken}
	client := googleOauthCfg.Client(ctx, token)
	svc, err := calendar.NewService(ctx, option.WithHTTPClient(client))

	return svc, &emp.Employee, err
}

// getFreeSlots devuelve los horarios libres de un empleado para un día concreto.
func getFreeSlots(ctx context.Context, negocioID, empID string, day time.Time) ([]string, error) {
	svc, emp, err := calendarServiceForEmployee(ctx, negocioID, empID)
	if err != nil {
		// Mock para desarrollo frontend si el calendario no está vinculado
		log.Printf("Aviso: %v. Devolviendo slots falsos.", err)
		return []string{"09:00", "10:00", "11:30", "14:00", "15:00", "16:30"}, nil
	}

	start := time.Date(day.Year(), day.Month(), day.Day(), 9, 0, 0, 0, bogotaLocation())
	end := start.Add(9 * time.Hour)

	req := &calendar.FreeBusyRequest{
		TimeMin: start.Format(time.RFC3339),
		TimeMax: end.Format(time.RFC3339),
		Items:   []*calendar.FreeBusyRequestItem{{Id: emp.CalendarID}},
	}
	result, err := svc.Freebusy.Query(req).Context(ctx).Do()
	if err != nil {
		return nil, err
	}

	var busyPeriods [][2]time.Time
	for _, cal := range result.Calendars {
		for _, period := range cal.Busy {
			tStart, _ := time.Parse(time.RFC3339, period.Start)
			tEnd, _ := time.Parse(time.RFC3339, period.End)
			busyPeriods = append(busyPeriods, [2]time.Time{tStart, tEnd})
		}
	}

	var slots []string
	for h := 9; h < 18; h++ {
		slotStart := time.Date(day.Year(), day.Month(), day.Day(), h, 0, 0, 0, bogotaLocation())
		slotEnd := slotStart.Add(1 * time.Hour)
		free := true
		for _, bp := range busyPeriods {
			if slotStart.Before(bp[1]) && slotEnd.After(bp[0]) {
				free = false
				break
			}
		}
		if free && slotStart.After(time.Now()) {
			slots = append(slots, slotStart.Format("15:04"))
		}
	}
	return slots, nil
}

// hasCustomerOverlap verifica si el cliente ya tiene una cita que se superpone
// con el horario solicitado (mismo negocio, mismo teléfono, hora dentro de ±60 min).
func hasCustomerOverlap(ctx context.Context, negocioID, phone string, requested time.Time) bool {
	if phone == "" {
		return false
	}

	docs, err := firestoreClient.Collection("reservas").
		Where("user_phone", "==", phone).
		Documents(ctx).GetAll()
	if err != nil {
		log.Printf("Aviso: error verificando overlap del cliente: %v", err)
		return false // No bloquear la reserva si hay error de Firestore
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
func createCalendarEvent(ctx context.Context, negocioID, empID, serviceName string, start time.Time) string {
	svc, emp, err := calendarServiceForEmployee(ctx, negocioID, empID)
	if err != nil {
		log.Printf("Aviso: %v. Generando mock event ID.", err)
		return "mock_event_123"
	}

	end := start.Add(1 * time.Hour)

	evt := &calendar.Event{
		Summary:     fmt.Sprintf("Cita - %s", serviceName),
		Description: "Agendado automáticamente vía Turnobot Web",
		Start: &calendar.EventDateTime{
			DateTime: start.Format(time.RFC3339),
			TimeZone: "America/Bogota",
		},
		End: &calendar.EventDateTime{
			DateTime: end.Format(time.RFC3339),
			TimeZone: "America/Bogota",
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

	// Renderizar pantalla de éxito y redirigir
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	html := fmt.Sprintf(`
		<div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
			<h2 style="color: #4CAF50;">✅ ¡Google Calendar vinculado con éxito!</h2>
			<p>Ya puedes empezar a recibir reservas.</p>
			<p style="color: gray; font-size: 14px;">Redirigiendo a tu panel...</p>
			<script>setTimeout(() => window.location.href='%s', 3000)</script>
		</div>
	`, frontendURL)
	fmt.Fprint(w, html)
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "Turnobot API REST OK")
}