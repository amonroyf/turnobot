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

func TestCancelIdempotenteYLiberaSlot(t *testing.T) {
	testFirestoreClient(t)
	ctx := context.Background()
	slug := slugUnico("test-cancel")
	seedTienda(t, ctx, slug)
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

	if c := deleteCita(t, slug, ids[0]); c != http.StatusOK {
		t.Fatalf("cancel 1 code=%d", c)
	}
	if c := deleteCita(t, slug, ids[0]); c != http.StatusOK {
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
