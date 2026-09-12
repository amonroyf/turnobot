package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
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
