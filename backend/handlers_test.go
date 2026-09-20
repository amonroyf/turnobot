package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"cloud.google.com/go/firestore"
)

// Tests de handlers contra el emulador de Firestore.
// Requieren: firebase emulators:start --only firestore (puerto 8090) y
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8090. Sin emulador se omiten para no
// tocar producción.

// mañanaStr devuelve la fecha de mañana en formato YYYY-MM-DD.
func mañanaStr() string {
	return time.Now().Add(24 * time.Hour).Format("2006-01-02")
}

// slugUnico evita colisiones entre corridas (el emulador persiste datos
// mientras esté levantado).
func slugUnico(base string) string {
	return fmt.Sprintf("%s-%d", base, time.Now().UnixNano())
}

func testFirestoreClient(t *testing.T) *firestore.Client {
	t.Helper()
	if os.Getenv("FIRESTORE_EMULATOR_HOST") == "" {
		t.Skip("sin emulador (FIRESTORE_EMULATOR_HOST vacío), se omite")
	}
	ctx := context.Background()
	c, err := firestore.NewClient(ctx, "test-turnobot")
	if err != nil {
		t.Fatalf("emulador no disponible: %v", err)
	}
	firestoreClient = c
	t.Cleanup(func() { c.Close() })
	return c
}

// seedTienda crea negocio + servicio (30 min) + empleado sin calendar (mock).
func seedTienda(t *testing.T, ctx context.Context, slug string) {
	t.Helper()
	c := firestoreClient
	_, err := c.Collection("negocios").Doc(slug).Set(ctx, map[string]interface{}{
		"name": "Tienda Test", "owner_uid": "owner-test",
		"timezone": "America/Bogota", "open_time": "09:00", "close_time": "18:00",
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = c.Collection("negocios").Doc(slug).Collection("servicios").Doc("svc1").Set(ctx, map[string]interface{}{
		"name": "Corte", "duration_minutes": 30, "price": "10000",
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = c.Collection("negocios").Doc(slug).Collection("empleados").Doc("emp1").Set(ctx, map[string]interface{}{
		"name": "Ana",
	})
	if err != nil {
		t.Fatal(err)
	}
}

func postBook(t *testing.T, slug string, payload map[string]string) (int, map[string]interface{}) {
	t.Helper()
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	bookHandler(rec, req, slug)
	var out map[string]interface{}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func reservaIDsPorTelefono(t *testing.T, ctx context.Context, slug, phone string) []string {
	t.Helper()
	docs, err := firestoreClient.Collection("reservas").
		Where("negocio_id", "==", slug).
		Where("user_phone", "==", phone).
		Documents(ctx).GetAll()
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, d := range docs {
		ids = append(ids, d.Ref.ID)
	}
	return ids
}

func visitasCliente(t *testing.T, ctx context.Context, slug, phone string) int64 {
	t.Helper()
	doc, err := firestoreClient.Collection("clientes").Doc(clienteDocID(slug, phone)).Get(ctx)
	if err != nil {
		return 0
	}
	v, _ := doc.Data()["visits"].(int64)
	return v
}

func TestBookHappyPath(t *testing.T) {
	c := testFirestoreClient(t)
	ctx := context.Background()
	slug := slugUnico("test-book")
	seedTienda(t, ctx, slug)
	_ = c

	phone := "+573001234567"
	code, out := postBook(t, slug, map[string]string{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": mañanaStr(), "hora": "09:30",
		"clienteNombre": "Juan", "clienteTelefono": phone,
	})
	if code != http.StatusCreated || out["success"] != true {
		t.Fatalf("code=%d out=%v", code, out)
	}
	if ids := reservaIDsPorTelefono(t, ctx, slug, phone); len(ids) != 1 {
		t.Fatalf("esperaba 1 reserva, hay %d", len(ids))
	}
	if v := visitasCliente(t, ctx, slug, phone); v != 1 {
		t.Fatalf("visits=%d, esperaba 1", v)
	}
}

func TestBookServicioInvalido(t *testing.T) {
	testFirestoreClient(t)
	ctx := context.Background()
	slug := slugUnico("test-badsvc")
	seedTienda(t, ctx, slug)

	code, out := postBook(t, slug, map[string]string{
		"servicioId": "no-existe", "empleadoId": "emp1",
		"fecha": mañanaStr(), "hora": "09:30",
		"clienteNombre": "Juan", "clienteTelefono": "+573001234567",
	})
	if code != http.StatusBadRequest || out["error"] != "servicio_no_encontrado" {
		t.Fatalf("code=%d out=%v", code, out)
	}
	if ids := reservaIDsPorTelefono(t, ctx, slug, "+573001234567"); len(ids) != 0 {
		t.Fatalf("no debió crear reserva, hay %d", len(ids))
	}
}

func TestBookServicioNoOfrecido(t *testing.T) {
	testFirestoreClient(t)
	ctx := context.Background()
	slug := slugUnico("test-noofrece")
	seedTienda(t, ctx, slug)

	// emp1 solo ofrece "otro-svc": reservar svc1 debe rechazarse sin crear nada.
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Collection("empleados").Doc("emp1").Set(ctx, map[string]interface{}{
		"servicios_ids": []string{"otro-svc"},
	}, firestore.MergeAll); err != nil {
		t.Fatal(err)
	}

	code, out := postBook(t, slug, map[string]string{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": mañanaStr(), "hora": "09:30",
		"clienteNombre": "Juan", "clienteTelefono": "+573001234567",
	})
	if code != http.StatusBadRequest || out["error"] != "servicio_no_ofrecido" {
		t.Fatalf("code=%d out=%v (esperaba 400 servicio_no_ofrecido)", code, out)
	}
	if ids := reservaIDsPorTelefono(t, ctx, slug, "+573001234567"); len(ids) != 0 {
		t.Fatalf("no debió crear reserva, hay %d", len(ids))
	}
}

func TestBookTelefonoInvalido(t *testing.T) {
	testFirestoreClient(t)
	ctx := context.Background()
	slug := slugUnico("test-badphone")
	seedTienda(t, ctx, slug)

	code, out := postBook(t, slug, map[string]string{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": mañanaStr(), "hora": "09:30",
		"clienteNombre": "Juan", "clienteTelefono": "123",
	})
	if code != http.StatusBadRequest || out["error"] != "invalid_phone" {
		t.Fatalf("code=%d out=%v", code, out)
	}
}

// TestBookConcurrenteMismoSlot lanza N reservas simultáneas al mismo slot:
// exactamente una debe ganar (201) y el resto 409, sin doble reserva.
func TestBookConcurrenteMismoSlot(t *testing.T) {
	testFirestoreClient(t)
	ctx := context.Background()
	slug := slugUnico("test-race")
	seedTienda(t, ctx, slug)

	const n = 8
	var ok, conflictos, otros int64
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			phone := fmt.Sprintf("+57300%07d", 1234500+i)
			code, _ := postBook(t, slug, map[string]string{
				"servicioId": "svc1", "empleadoId": "emp1",
				"fecha": mañanaStr(), "hora": "10:00",
				"clienteNombre": "Race", "clienteTelefono": phone,
			})
			switch code {
			case http.StatusCreated:
				atomic.AddInt64(&ok, 1)
			case http.StatusConflict:
				atomic.AddInt64(&conflictos, 1)
			default:
				atomic.AddInt64(&otros, 1)
			}
		}(i)
	}
	wg.Wait()
	if ok != 1 {
		t.Fatalf("ganadores=%d (esperaba 1), conflictos=%d otros=%d", ok, conflictos, otros)
	}
	if otros != 0 {
		t.Fatalf("hubo %d respuestas inesperadas (no 201/409)", otros)
	}
	// Solo una reserva no cancelada en ese slot.
	docs, err := firestoreClient.Collection("reservas").
		Where("negocio_id", "==", slug).
		Where("emp_id", "==", "emp1").
		Documents(ctx).GetAll()
	if err != nil {
		t.Fatal(err)
	}
	activas := 0
	for _, d := range docs {
		if d.Data()["cancelled"] != true {
			activas++
		}
	}
	if activas != 1 {
		t.Fatalf("reservas activas=%d, esperaba 1", activas)
	}
}

func deleteCita(t *testing.T, slug, id string) int {
	t.Helper()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/b/"+slug+"/citas/"+id, nil)
	rec := httptest.NewRecorder()
	cancelCitaHandler(rec, req, slug, id)
	return rec.Code
}

// deleteCitaComoCliente cancela con el header del cliente (flujo real de
// MisCitas): sin esto el handler responde 403 por falta de autorización.
func deleteCitaComoCliente(t *testing.T, slug, id, phone string) int {
	t.Helper()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/b/"+slug+"/citas/"+id, nil)
	req.Header.Set("X-Client-Phone", phone)
	rec := httptest.NewRecorder()
	cancelCitaHandler(rec, req, slug, id)
	return rec.Code
}

func TestCancelIdempotenteYLiberaSlot(t *testing.T) {
	testFirestoreClient(t)
	ctx := context.Background()
	slug := slugUnico("test-cancel")
	seedTienda(t, ctx, slug)
	// Ventana corta para que la cita de mañana sea cancelable por el cliente
	// (el default de 24h la bloquearía según la hora de corrida).
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Set(ctx, map[string]interface{}{
		"cancel_window_hours": 2,
	}, firestore.MergeAll); err != nil {
		t.Fatal(err)
	}
	phone := "+573001234567"
	fecha := mañanaStr()

	code, _ := postBook(t, slug, map[string]string{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": fecha, "hora": "11:00",
		"clienteNombre": "Juan", "clienteTelefono": phone,
	})
	if code != http.StatusCreated {
		t.Fatalf("book code=%d", code)
	}
	ids := reservaIDsPorTelefono(t, ctx, slug, phone)
	if len(ids) != 1 {
		t.Fatalf("reservas=%d", len(ids))
	}

	slotsAntes, err := getFreeSlots(ctx, slug, "emp1", mustParseFecha(t, fecha), 30)
	if err != nil {
		t.Fatal(err)
	}
	if contiene(slotsAntes, "11:00") {
		t.Fatal("el slot ocupado no debió listarse libre")
	}

	if c := deleteCitaComoCliente(t, slug, ids[0], phone); c != http.StatusOK {
		t.Fatalf("cancel 1 code=%d", c)
	}
	if c := deleteCitaComoCliente(t, slug, ids[0], phone); c != http.StatusOK {
		t.Fatalf("cancel 2 (idempotente) code=%d", c)
	}
	if v := visitasCliente(t, ctx, slug, phone); v != 0 {
		t.Fatalf("visits=%d tras doble cancel, esperaba 0", v)
	}

	slotsDespues, err := getFreeSlots(ctx, slug, "emp1", mustParseFecha(t, fecha), 30)
	if err != nil {
		t.Fatal(err)
	}
	if !contiene(slotsDespues, "11:00") {
		t.Fatal("el slot cancelado debió liberarse")
	}
}

func TestNoShowSinAuthEs401(t *testing.T) {
	testFirestoreClient(t)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/b/x/no-show/abc", nil)
	rec := httptest.NewRecorder()
	markNoShowHandler(rec, req, "x", "abc")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("code=%d, esperaba 401", rec.Code)
	}
}

func mustParseFecha(t *testing.T, s string) time.Time {
	t.Helper()
	d, err := time.Parse("2006-01-02", s)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func contiene(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}

func TestBookMuyProntoRechazado(t *testing.T) {
	testFirestoreClient(t)
	ctx := context.Background()
	slug := slugUnico("test-notice")
	seedTienda(t, ctx, slug)
	// Fijar aviso de 120 min explícito (el default del sistema ahora es 0).
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Set(ctx, map[string]interface{}{
		"min_notice_minutes": 120,
	}, firestore.MergeAll); err != nil {
		t.Fatal(err)
	}

	// Slot hoy: siguiente fracción de 30 min (siempre < 120 min de aviso).
	now := time.Now()
	hora := now.Truncate(30 * time.Minute)
	if !hora.After(now) {
		hora = hora.Add(30 * time.Minute)
	}
	fecha := hora.Format("2006-01-02")

	code, out := postBook(t, slug, map[string]string{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": fecha, "hora": hora.Format("15:04"),
		"clienteNombre": "Juan", "clienteTelefono": "+573001234567",
	})
	if code != http.StatusBadRequest || out["error"] != "muy_pronto" {
		t.Fatalf("code=%d out=%v (esperaba 400 muy_pronto)", code, out)
	}
	if ids := reservaIDsPorTelefono(t, ctx, slug, "+573001234567"); len(ids) != 0 {
		t.Fatalf("no debió crear reserva, hay %d", len(ids))
	}
}

func TestBookMinNoticeConfigurable(t *testing.T) {
	testFirestoreClient(t)
	ctx := context.Background()
	slug := slugUnico("test-notice-cfg")
	seedTienda(t, ctx, slug)
	// Negocio con aviso de solo 10 minutos.
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Set(ctx, map[string]interface{}{
		"min_notice_minutes": 10,
	}, firestore.MergeAll); err != nil {
		t.Fatal(err)
	}

	now := time.Now()
	hora := now.Truncate(30 * time.Minute)
	if !hora.After(now) {
		hora = hora.Add(30 * time.Minute)
	}
	// Margen: con aviso de 10min, si el próximo slot está a <15min el backend
	// lo rechaza correctamente; tomar el siguiente para probar el happy path.
	if hora.Sub(now) < 15*time.Minute {
		hora = hora.Add(30 * time.Minute)
	}
	// El slot debe existir en la jornada 09:00-18:00; si es de noche, usar mañana 09:30.
	fecha := hora.Format("2006-01-02")
	horaStr := hora.Format("15:04")
	if hora.Hour() < 8 || hora.Hour() >= 18 {
		fecha = mañanaStr()
		horaStr = "09:30"
	}

	code, out := postBook(t, slug, map[string]string{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": fecha, "hora": horaStr,
		"clienteNombre": "Juan", "clienteTelefono": "+573001234567",
	})
	if code != http.StatusCreated {
		t.Fatalf("code=%d out=%v (con aviso 10min debió pasar)", code, out)
	}
}

func TestBookHoneypotFingeExito(t *testing.T) {
	testFirestoreClient(t)
	ctx := context.Background()
	slug := slugUnico("test-honeypot")
	seedTienda(t, ctx, slug)

	code, out := postBook(t, slug, map[string]string{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": mañanaStr(), "hora": "09:30",
		"clienteNombre": "Spam Bot", "clienteTelefono": "+573001234567",
		"website": "http://spam.example",
	})
	if code != http.StatusCreated || out["success"] != true {
		t.Fatalf("el honeypot debe fingir éxito: code=%d out=%v", code, out)
	}
	if ids := reservaIDsPorTelefono(t, ctx, slug, "+573001234567"); len(ids) != 0 {
		t.Fatalf("el bot no debió crear nada, hay %d", len(ids))
	}
	if v := visitasCliente(t, ctx, slug, "+573001234567"); v != 0 {
		t.Fatalf("visits=%d, esperaba 0", v)
	}
}

func TestBookConNotasYPersistencia(t *testing.T) {
	testFirestoreClient(t)
	ctx := context.Background()
	slug := slugUnico("test-notas")
	seedTienda(t, ctx, slug)
	phone := "+573001234567"

	code, _ := postBook(t, slug, map[string]string{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": mañanaStr(), "hora": "09:30",
		"clienteNombre": "Juan", "clienteTelefono": phone,
		"clienteNotas": "Corte degradado, alérgico a la loción X",
	})
	if code != http.StatusCreated {
		t.Fatalf("book code=%d", code)
	}
	ids := reservaIDsPorTelefono(t, ctx, slug, phone)
	if len(ids) != 1 {
		t.Fatalf("reservas=%d", len(ids))
	}
	doc, err := firestoreClient.Collection("reservas").Doc(ids[0]).Get(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var b Booking
	doc.DataTo(&b)
	if b.Notes != "Corte degradado, alérgico a la loción X" {
		t.Fatalf("notes=%q", b.Notes)
	}

	// Notas demasiado largas se rechazan.
	largas := ""
	for i := 0; i < 501; i++ {
		largas += "x"
	}
	code, out := postBook(t, slug, map[string]string{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": mañanaStr(), "hora": "10:30",
		"clienteNombre": "Juan", "clienteTelefono": phone,
		"clienteNotas": largas,
	})
	if code != http.StatusBadRequest || out["error"] != "notas_muy_largas" {
		t.Fatalf("code=%d out=%v", code, out)
	}
}

func TestFormatBookingDescription(t *testing.T) {
	cases := []struct {
		name, phone, want string
	}{
		{"Juan", "+573001234567", "Cliente: Juan\nTeléfono: +573001234567"},
		{"Ana", "", "Cliente: Ana"},
		{"", "+573001234567", "Teléfono: +573001234567"},
		{"", "", ""},
	}
	for _, c := range cases {
		got := formatBookingDescription(c.name, c.phone)
		if got != c.want {
			t.Errorf("formatBookingDescription(%q, %q)=%q, want %q", c.name, c.phone, got, c.want)
		}
	}
}

func TestFirstLinesSuffix(t *testing.T) {
	if got := firstLinesSuffix(""); got != "" {
		t.Errorf("firstLinesSuffix(\"\")=%q, want empty", got)
	}
	if got := firstLinesSuffix("nota corta"); got != "\nNotas del cliente: nota corta" {
		t.Errorf("got=%q", got)
	}
	// Más de 200 caracteres se recorta.
	larga := strings.Repeat("x", 250)
	got := firstLinesSuffix(larga)
	if !strings.HasPrefix(got, "\nNotas del cliente: ") {
		t.Errorf("prefix wrong: %q", got)
	}
	if len(got) < 20 {
		t.Errorf("too short: %d", len(got))
	}
}

func seedRecurso(t *testing.T, ctx context.Context, slug, id, nombre string) {
	t.Helper()
	_, err := firestoreClient.Collection("negocios").Doc(slug).Collection("recursos").Doc(id).Set(ctx, map[string]interface{}{
		"name": nombre, "tipo": "cancha", "capacidad": 1,
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestBookConRecursoSinEmpleado(t *testing.T) {
	testFirestoreClient(t)
	ctx := context.Background()
	slug := slugUnico("test-rec")
	seedTienda(t, ctx, slug)
	seedRecurso(t, ctx, slug, "rec1", "Cancha 1")

	code, out := postBook(t, slug, map[string]string{
		"servicioId": "svc1", "recursoId": "rec1",
		"fecha": mañanaStr(), "hora": "10:00",
		"clienteNombre": "Juan", "clienteTelefono": "+573001111111",
	})
	if code != http.StatusCreated || out["success"] != true {
		t.Fatalf("code=%d out=%v", code, out)
	}
	// La reserva guarda el recurso desnormalizado y sin evento de Calendar.
	ids := reservaIDsPorTelefono(t, ctx, slug, "+573001111111")
	if len(ids) != 1 {
		t.Fatalf("reservas=%d", len(ids))
	}
	doc, _ := firestoreClient.Collection("reservas").Doc(ids[0]).Get(ctx)
	var b Booking
	doc.DataTo(&b)
	if b.RecursoID != "rec1" || b.RecursoName != "Cancha 1" {
		t.Fatalf("recurso=%q/%q", b.RecursoID, b.RecursoName)
	}
	if b.CalendarEvt != "" {
		t.Fatalf("sin profesional no debe haber evento de Calendar, hay %q", b.CalendarEvt)
	}
	// La hora ocupada ya no sale libre para el recurso.
	slots, err := getFreeSlotsRecurso(ctx, slug, "rec1", mustParseFecha(t, mañanaStr()), 30)
	if err != nil {
		t.Fatal(err)
	}
	if contiene(slots, "10:00") {
		t.Fatal("el slot ocupado del recurso no debió listarse libre")
	}
}

func TestBookRecursoSolapeYLibre(t *testing.T) {
	testFirestoreClient(t)
	ctx := context.Background()
	slug := slugUnico("test-rec2")
	seedTienda(t, ctx, slug)
	seedRecurso(t, ctx, slug, "rec1", "Cancha 1")
	seedRecurso(t, ctx, slug, "rec2", "Cancha 2")
	fecha := mañanaStr()

	book := func(phone, recurso, hora string) int {
		code, _ := postBook(t, slug, map[string]string{
			"servicioId": "svc1", "recursoId": recurso,
			"fecha": fecha, "hora": hora,
			"clienteNombre": "X", "clienteTelefono": phone,
		})
		return code
	}
	if c := book("+573002222221", "rec1", "10:00"); c != http.StatusCreated {
		t.Fatalf("primera reserva code=%d", c)
	}
	// Mismo recurso, misma hora, otro teléfono -> conflicto.
	if c := book("+573002222222", "rec1", "10:00"); c != http.StatusConflict {
		t.Fatalf("solape mismo recurso code=%d, esperaba 409", c)
	}
	// Otro recurso, misma hora -> libre.
	if c := book("+573002222223", "rec2", "10:00"); c != http.StatusCreated {
		t.Fatalf("otro recurso code=%d, esperaba 201", c)
	}
	// Mismo recurso, otra hora -> libre.
	if c := book("+573002222224", "rec1", "11:00"); c != http.StatusCreated {
		t.Fatalf("otra hora code=%d, esperaba 201", c)
	}
	// Recurso inexistente -> 400.
	if c := book("+573002222225", "no-existe", "12:00"); c != http.StatusBadRequest {
		t.Fatalf("recurso inexistente code=%d, esperaba 400", c)
	}
	// Sin profesional ni recurso -> 400.
	code, _ := postBook(t, slug, map[string]string{
		"servicioId": "svc1",
		"fecha":      fecha, "hora": "12:00",
		"clienteNombre": "X", "clienteTelefono": "+573002222226",
	})
	if code != http.StatusBadRequest {
		t.Fatalf("sin destino code=%d, esperaba 400", code)
	}
}

func seedRecursoCap(t *testing.T, ctx context.Context, slug, id string, capacidad int) {
	t.Helper()
	_, err := firestoreClient.Collection("negocios").Doc(slug).Collection("recursos").Doc(id).Set(ctx, map[string]interface{}{
		"name": "Clase " + id, "tipo": "clase", "capacidad": capacidad,
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestRecursoCuposLlenado(t *testing.T) {
	testFirestoreClient(t)
	ctx := context.Background()
	slug := slugUnico("test-cupo")
	seedTienda(t, ctx, slug)
	seedRecursoCap(t, ctx, slug, "rec1", 4)
	fecha := mañanaStr()

	book := func(phone string, cupos int) int {
		// postBook es map[string]string (sin cupos): se serializa manual.
		body, _ := json.Marshal(map[string]interface{}{
			"servicioId": "svc1", "recursoId": "rec1",
			"fecha": fecha, "hora": "10:00",
			"clienteNombre": "X", "clienteTelefono": phone,
			"cupos": cupos,
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		bookHandler(rec, req, slug)
		return rec.Code
	}

	// 4 cupos de 4: entran.
	for i := 0; i < 4; i++ {
		if c := book("+57300333330"+string(rune('0'+i)), 1); c != http.StatusCreated {
			t.Fatalf("cupo %d code=%d, esperaba 201", i+1, c)
		}
	}
	// 5to: sin cupo.
	if c := book("+573003333304", 1); c != http.StatusConflict {
		t.Fatalf("lleno code=%d, esperaba 409", c)
	}
	// Otra hora: libre.
	payload := map[string]string{
		"servicioId": "svc1", "recursoId": "rec1",
		"fecha": fecha, "hora": "11:00",
		"clienteNombre": "X", "clienteTelefono": "+573003333305",
	}
	if code, _ := postBook(t, slug, payload); code != http.StatusCreated {
		t.Fatalf("otra hora code=%d, esperaba 201", code)
	}
	// Una reserva no puede pedir más que la capacidad.
	body, _ := json.Marshal(map[string]interface{}{
		"servicioId": "svc1", "recursoId": "rec1",
		"fecha": fecha, "hora": "11:00",
		"clienteNombre": "X", "clienteTelefono": "+573003333306",
		"cupos": 5,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	bookHandler(rec, req, slug)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("cupos>cap code=%d, esperaba 400", rec.Code)
	}
}

func TestRecursoHorarioPropio(t *testing.T) {
	testFirestoreClient(t)
	ctx := context.Background()
	slug := slugUnico("test-rec3")
	seedTienda(t, ctx, slug)
	// Recurso con horario propio (solo lunes 10:00-12:00).
	_, err := firestoreClient.Collection("negocios").Doc(slug).Collection("recursos").Doc("rec1").Set(ctx, map[string]interface{}{
		"name": "Box 1", "tipo": "box", "capacidad": 3,
		"horario": map[string]interface{}{
			"lunes":     map[string]interface{}{"activo": true, "turnos": []interface{}{map[string]interface{}{"inicio": "10:00", "fin": "12:00"}}},
			"martes":    map[string]interface{}{"activo": false, "turnos": []interface{}{}},
			"miercoles": map[string]interface{}{"activo": false, "turnos": []interface{}{}},
			"jueves":    map[string]interface{}{"activo": false, "turnos": []interface{}{}},
			"viernes":   map[string]interface{}{"activo": false, "turnos": []interface{}{}},
			"sabado":    map[string]interface{}{"activo": false, "turnos": []interface{}{}},
			"domingo":   map[string]interface{}{"activo": false, "turnos": []interface{}{}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	// Próximo lunes (máx 7 intentos por si hoy es lunes pasado el horario).
	var lunes time.Time
	for d := 1; d <= 8; d++ {
		cand := time.Now().AddDate(0, 0, d)
		if cand.Weekday() == time.Monday {
			lunes = cand
			break
		}
	}
	fecha := lunes.Format("2006-01-02")
	slots, _, err := disponibilidadRecurso(ctx, slug, "rec1", lunes, 60, 1)
	if err != nil {
		t.Fatal(err)
	}
	// Rejilla 60 min en 10:00-12:00 -> 10:00 y 11:00.
	if len(slots) == 0 {
		t.Fatalf("el lunes con horario propio debería tener slots en %s", fecha)
	}
	// Martes (día inactivo con horario propio) -> vacío.
	var martes time.Time
	for d := 1; d <= 8; d++ {
		cand := time.Now().AddDate(0, 0, d)
		if cand.Weekday() == time.Tuesday {
			martes = cand
			break
		}
	}
	slotsM, _, err := disponibilidadRecurso(ctx, slug, "rec1", martes, 60, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(slotsM) != 0 {
		t.Fatalf("el martes inactivo debería estar vacío, hay %v", slotsM)
	}

	// Reserva lunes 10:00 (60 min, 3 cupos = lleno): bloquea 10:00, 11:00 libre.
	body, _ := json.Marshal(map[string]interface{}{
		"servicioId": "svc1", "recursoId": "rec1",
		"fecha": fecha, "hora": "10:00",
		"clienteNombre": "X", "clienteTelefono": "+573004444441",
		"cupos":         3,
		"participantes": []string{"Ana", "Luis"},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	bookHandler(rec, req, slug)
	if rec.Code != http.StatusCreated {
		t.Fatalf("book con participantes code=%d body=%s", rec.Code, rec.Body.String())
	}
	ids := reservaIDsPorTelefono(t, ctx, slug, "+573004444441")
	if len(ids) != 1 {
		t.Fatalf("reservas=%d", len(ids))
	}
	doc, _ := firestoreClient.Collection("reservas").Doc(ids[0]).Get(ctx)
	var b Booking
	doc.DataTo(&b)
	if len(b.Participantes) != 2 || b.Participantes[0] != "Ana" {
		t.Fatalf("participantes=%v", b.Participantes)
	}
	slots2, _, err := disponibilidadRecurso(ctx, slug, "rec1", lunes, 60, 1)
	if err != nil {
		t.Fatal(err)
	}
	// 10:00 ocupada (capacidad llena); 11:00 libre (sin buffer: un turno
	// puede empezar justo cuando termina otro).
	for _, s := range slots2 {
		if s == "10:00" {
			t.Fatalf("slot 10:00 debió estar bloqueado (lleno), libres=%v", slots2)
		}
	}
	hay11 := false
	for _, s := range slots2 {
		if s == "11:00" {
			hay11 = true
		}
	}
	if !hay11 {
		t.Fatalf("slot 11:00 debió estar libre, libres=%v", slots2)
	}
}

func TestBookRecursoSinServicio(t *testing.T) {
	testFirestoreClient(t)
	ctx := context.Background()
	slug := slugUnico("test-rec4")
	seedTienda(t, ctx, slug)
	seedRecurso(t, ctx, slug, "rec1", "Cancha 1")

	// Modo "reservar espacio": sin servicioId ni empleadoId.
	body, _ := json.Marshal(map[string]interface{}{
		"recursoId": "rec1",
		"fecha":     mañanaStr(), "hora": "10:00",
		"clienteNombre": "X", "clienteTelefono": "+573005555551",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	bookHandler(rec, req, slug)
	if rec.Code != http.StatusCreated {
		t.Fatalf("code=%d body=%s, esperaba 201", rec.Code, rec.Body.String())
	}
	ids := reservaIDsPorTelefono(t, ctx, slug, "+573005555551")
	if len(ids) != 1 {
		t.Fatalf("reservas=%d", len(ids))
	}
	doc, _ := firestoreClient.Collection("reservas").Doc(ids[0]).Get(ctx)
	var b Booking
	doc.DataTo(&b)
	if b.ServiceName != "Reserva de Cancha 1" {
		t.Fatalf("service=%q", b.ServiceName)
	}
	if b.EmpID != "" {
		t.Fatalf("emp=%q, esperaba vacío (el local asigna)", b.EmpID)
	}

	// Sin servicio Y sin recurso -> 400.
	body2, _ := json.Marshal(map[string]interface{}{
		"fecha": mañanaStr(), "hora": "11:00",
		"clienteNombre": "X", "clienteTelefono": "+573005555552",
	})
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body2))
	req2.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	bookHandler(rec2, req2, slug)
	if rec2.Code != http.StatusBadRequest {
		t.Fatalf("sin servicio ni recurso code=%d, esperaba 400", rec2.Code)
	}
}

func TestRecursoClasePredefinidaHereda(t *testing.T) {
	testFirestoreClient(t)
	ctx := context.Background()
	slug := slugUnico("test-rec5")
	seedTienda(t, ctx, slug)
	// Clase predefinida: Yoga es svc1 (Corte/30 min) dictada por emp1 (Ana).
	_, err := firestoreClient.Collection("negocios").Doc(slug).Collection("recursos").Doc("rec1").Set(ctx, map[string]interface{}{
		"name": "Sala Yoga", "tipo": "clase", "capacidad": 10,
		"servicio_id": "svc1", "emp_id": "emp1",
	})
	if err != nil {
		t.Fatal(err)
	}

	// Modo espacio sin servicio ni empleado: hereda del espacio.
	body, _ := json.Marshal(map[string]interface{}{
		"recursoId": "rec1",
		"fecha":     mañanaStr(), "hora": "10:00",
		"clienteNombre": "X", "clienteTelefono": "+573005555553",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	bookHandler(rec, req, slug)
	if rec.Code != http.StatusCreated {
		t.Fatalf("code=%d body=%s, esperaba 201", rec.Code, rec.Body.String())
	}
	ids := reservaIDsPorTelefono(t, ctx, slug, "+573005555553")
	if len(ids) != 1 {
		t.Fatalf("reservas=%d", len(ids))
	}
	doc, _ := firestoreClient.Collection("reservas").Doc(ids[0]).Get(ctx)
	var b Booking
	doc.DataTo(&b)
	if b.ServiceName != "Corte" {
		t.Fatalf("service=%q, esperaba el atado (Corte)", b.ServiceName)
	}
	if b.DurationMinute != 30 {
		t.Fatalf("dur=%d, esperaba 30 del servicio atado", b.DurationMinute)
	}
	if b.EmpID != "emp1" {
		t.Fatalf("emp=%q, esperaba emp1 (Ana atada)", b.EmpID)
	}
}
