package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	firebase "firebase.google.com/go/v4"
	"cloud.google.com/go/firestore"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
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
	authClienteTest(t, req)
	rec := httptest.NewRecorder()
	bookHandler(rec, req, slug)
	var out map[string]interface{}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

// testAuthClient inicializa el cliente Firebase Auth contra el emulador
// (FIREBASE_AUTH_EMULATOR_HOST). Sin emulador Auth se omite.
var authInitOnce sync.Once

func testAuthClient(t *testing.T) {
	t.Helper()
	if os.Getenv("FIRESTORE_EMULATOR_HOST") == "" || os.Getenv("FIREBASE_AUTH_EMULATOR_HOST") == "" {
		t.Skip("sin emuladores (Firestore/Auth), se omite")
	}
	authInitOnce.Do(func() {
		ctx := context.Background()
		// Mismo ProjectID que el emulador (demo-test): si no, VerifyIDToken
		// rechaza por 'aud' inválida.
		app, err := firebase.NewApp(ctx, &firebase.Config{ProjectID: "demo-test"})
		if err != nil {
			t.Fatalf("firebase app test: %v", err)
		}
		firebaseApp = app
		firebaseAuth, err = app.Auth(ctx)
		if err != nil {
			t.Fatalf("firebase auth test: %v", err)
		}
	})
}

// tokenClienteTest crea (o reusa) un usuario Google de prueba en el emulador
// Auth y retorna su ID token, como lo manda la web al reservar.
var clienteTokenCache sync.Map // email -> idToken

func tokenClienteTest(t *testing.T, email string) string {
	t.Helper()
	testAuthClient(t)
	if v, ok := clienteTokenCache.Load(email); ok {
		return v.(string)
	}
	host := os.Getenv("FIREBASE_AUTH_EMULATOR_HOST")
	authREST := func(op string, body string) (int, []byte) {
		req, _ := http.NewRequest(http.MethodPost,
			fmt.Sprintf("http://%s/identitytoolkit.googleapis.com/v1/accounts:%s?key=fake", host, op),
			strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("auth emulator %s: %v", op, err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return res.StatusCode, b
	}
	crear := fmt.Sprintf(`{"email":%q,"password":"test1234","returnSecureToken":true}`, email)
	code, b := authREST("signUp", crear)
	if code != 200 {
		if !strings.Contains(string(b), "EMAIL_EXISTS") {
			t.Fatalf("signUp test: code=%d body=%s", code, b)
		}
		var code2 int
		code2, b = authREST("signInWithPassword", crear)
		if code2 != 200 {
			t.Fatalf("signIn test: code=%d body=%s", code2, b)
		}
	}
	var out map[string]interface{}
	_ = json.Unmarshal(b, &out)
	tok, _ := out["idToken"].(string)
	uid, _ := out["localId"].(string)
	if tok == "" || uid == "" {
		t.Fatalf("auth test sin idToken/uid: %s", b)
	}
	clienteTokenCache.Store(email, tok)
	clienteUIDCache.Store(email, uid)
	return tok
}

// clienteUIDTest retorna el UID del usuario de prueba (para sembrar owner).
func clienteUIDTest(t *testing.T, email string) string {
	t.Helper()
	if v, ok := clienteUIDCache.Load(email); ok {
		return v.(string)
	}
	tokenClienteTest(t, email)
	if v, ok := clienteUIDCache.Load(email); ok {
		return v.(string)
	}
	t.Fatalf("sin UID para %s", email)
	return ""
}

var clienteUIDCache sync.Map // email -> uid

// authClienteTest adjunta el Bearer del cliente de prueba al request.
// Cada test usa su propio usuario (derivado de t.Name()): así el tope diario
// por UID no interfiere entre tests, pero sí aplica dentro de cada uno.
func authClienteTest(t *testing.T, req *http.Request) {
	t.Helper()
	email := strings.ToLower(strings.ReplaceAll(t.Name(), "/", "-")) + "@test.com"
	req.Header.Set("Authorization", "Bearer "+tokenClienteTest(t, email))
}

var clienteUnicoContador int64

// authClienteUnico adjunta un usuario NUEVO por llamado: simula clientes
// distintos llenando una clase (el tope por UID no debe frenarlos).
func authClienteUnico(t *testing.T, req *http.Request) {
	t.Helper()
	n := atomic.AddInt64(&clienteUnicoContador, 1)
	email := fmt.Sprintf("unico-%d@test.com", n)
	req.Header.Set("Authorization", "Bearer "+tokenClienteTest(t, email))
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
	// La cita se creó con el UID del test (postBook): el token manda.
	email := strings.ToLower(strings.ReplaceAll(t.Name(), "/", "-")) + "@test.com"
	req.Header.Set("Authorization", "Bearer "+tokenClienteTest(t, email))
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
		body, _ := json.Marshal(map[string]interface{}{
			"servicioId": "svc1", "recursoId": recurso,
			"fecha": fecha, "hora": hora,
			"clienteNombre": "X", "clienteTelefono": phone,
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		authClienteUnico(t, req)
		rec := httptest.NewRecorder()
		bookHandler(rec, req, slug)
		return rec.Code
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
		authClienteUnico(t, req)
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
	authClienteTest(t, req)
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

	// Tres personas (1 cupo c/u) llenan la capacidad 3 del lunes 10:00:
	// 10:00 bloqueada, 11:00 libre. Uno por persona, sin acompañantes.
	for i := 0; i < 3; i++ {
		body, _ := json.Marshal(map[string]interface{}{
			"servicioId": "svc1", "recursoId": "rec1",
			"fecha": fecha, "hora": "10:00",
			"clienteNombre": "X", "clienteTelefono": fmt.Sprintf("+57300444444%d", i),
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		authClienteUnico(t, req)
		rec := httptest.NewRecorder()
		bookHandler(rec, req, slug)
		if rec.Code != http.StatusCreated {
			t.Fatalf("persona %d code=%d body=%s, esperaba 201", i+1, rec.Code, rec.Body.String())
		}
	}
	// Pedir 2 cupos se rechaza (uno por persona).
	body, _ := json.Marshal(map[string]interface{}{
		"servicioId": "svc1", "recursoId": "rec1",
		"fecha": fecha, "hora": "11:00",
		"clienteNombre": "Y", "clienteTelefono": "+573004444449",
		"cupos": 2,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	authClienteUnico(t, req)
	rec := httptest.NewRecorder()
	bookHandler(rec, req, slug)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("cupos=2 code=%d, esperaba 400", rec.Code)
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
	authClienteTest(t, req)
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
	authClienteTest(t, req2)
	rec2 := httptest.NewRecorder()
	bookHandler(rec2, req2, slug)
	if rec2.Code != http.StatusBadRequest {
		t.Fatalf("sin servicio ni recurso code=%d, esperaba 400", rec2.Code)
	}
}

// El espacio con precio/duración propios los hereda la reserva (modo
// espacio sin servicio): la cita deja de ser 60 min a $0.
func TestRecursoPrecioDuracionHereda(t *testing.T) {
	testFirestoreClient(t)
	ctx := context.Background()
	slug := slugUnico("test-recpd")
	seedTienda(t, ctx, slug)
	_, err := firestoreClient.Collection("negocios").Doc(slug).Collection("recursos").Doc("rec1").Set(ctx, map[string]interface{}{
		"name": "Clase Crossfit", "tipo": "clase", "capacidad": 15,
		"duration_minutes": 90, "price": "25000",
	})
	if err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]interface{}{
		"recursoId": "rec1",
		"fecha": mañanaStr(), "hora": "10:30",
		"clienteNombre": "X", "clienteTelefono": "+573005555551",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	authClienteTest(t, req)
	rec := httptest.NewRecorder()
	bookHandler(rec, req, slug)
	if rec.Code != http.StatusCreated {
		t.Fatalf("code=%d body=%s, esperaba 201", rec.Code, rec.Body.String())
	}
	ids := reservaIDsPorTelefono(t, ctx, slug, "+573005555551")
	if len(ids) != 1 {
		t.Fatalf("reservas=%d, esperaba 1", len(ids))
	}
	doc, _ := firestoreClient.Collection("reservas").Doc(ids[0]).Get(ctx)
	var b Booking
	doc.DataTo(&b)
	if b.ServiceName != "Reserva de Clase Crossfit" {
		t.Fatalf("service=%q", b.ServiceName)
	}
	if b.DurationMinute != 90 {
		t.Fatalf("duracion=%d, esperaba 90", b.DurationMinute)
	}
	if b.Price != 25000 {
		t.Fatalf("price=%d, esperaba 25000", b.Price)
	}
	var out map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if p, _ := out["price"].(float64); p != 25000 {
		t.Fatalf("price respuesta=%v, esperaba 25000", out["price"])
	}
}


func TestEmpleadoAutonomoHorarioYPin(t *testing.T) {
	testFirestoreClient(t)
	ctx := context.Background()
	slug := slugUnico("test-empaut")
	seedTienda(t, ctx, slug)
	tok := signEmployeeToken(slug, "emp1")
	conToken := func(method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, bytes.NewReader([]byte(body)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		apiRouter(rec, req)
		return rec
	}

	// Mi horario: válido 200, inválido 400, otro empleado 401.
	ok := conToken(http.MethodPut, "/api/v1/b/"+slug+"/employee/emp1/horario",
		`{"lunes":{"activo":true,"turnos":[{"inicio":"09:00","fin":"13:00"}]}}`)
	if ok.Code != http.StatusOK {
		t.Fatalf("horario válido code=%d body=%s, esperaba 200", ok.Code, ok.Body.String())
	}
	bad := conToken(http.MethodPut, "/api/v1/b/"+slug+"/employee/emp1/horario",
		`{"lunes":{"activo":true,"turnos":[{"inicio":"13:00","fin":"09:00"}]}}`)
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("horario inválido code=%d, esperaba 400", bad.Code)
	}
	req := httptest.NewRequest(http.MethodPut, "/api/v1/b/"+slug+"/employee/emp1/horario", bytes.NewReader([]byte(`{}`)))
	rec := httptest.NewRecorder()
	apiRouter(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("sin token code=%d, esperaba 401", rec.Code)
	}

	// Mi clave: la cambia y entra con la nueva.
	ch := conToken(http.MethodPost, "/api/v1/b/"+slug+"/employee/emp1/pin", `{"pin":"5678"}`)
	if ch.Code != http.StatusOK {
		t.Fatalf("cambio pin code=%d body=%s, esperaba 200", ch.Code, ch.Body.String())
	}
	loginBody, _ := json.Marshal(map[string]string{"emp_id": "emp1", "pin": "5678"})
	lreq := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/employee-login", bytes.NewReader(loginBody))
	lreq.Header.Set("Content-Type", "application/json")
	lrec := httptest.NewRecorder()
	employeeLoginHandler(lrec, lreq, slug)
	if lrec.Code != http.StatusOK {
		t.Fatalf("login con pin nuevo code=%d body=%s, esperaba 200", lrec.Code, lrec.Body.String())
	}
	// PIN corto se rechaza.
	corto := conToken(http.MethodPost, "/api/v1/b/"+slug+"/employee/emp1/pin", `{"pin":"12"}`)
	if corto.Code != http.StatusBadRequest {
		t.Fatalf("pin corto code=%d, esperaba 400", corto.Code)
	}
}

// El empleado marca/desmarca Pagó solo en su agenda: mueve el contador
// cobrado-real del CRM; la cita ajena da 403.
func TestEmpleadoMarcaPagado(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-emppago")
	seedTienda(t, ctx, slug)
	code, _ := postBook(t, slug, map[string]string{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": mañanaStr(), "hora": "10:00",
		"clienteNombre": "Juan", "clienteTelefono": "+573001111111",
	})
	if code != http.StatusCreated {
		t.Fatalf("book code=%d, esperaba 201", code)
	}
	ids := reservaIDsPorTelefono(t, ctx, slug, "+573001111111")
	if len(ids) != 1 {
		t.Fatalf("reservas=%d, esperaba 1", len(ids))
	}
	tok := signEmployeeToken(slug, "emp1")
	pago := func(emp, body, token string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost,
			"/api/v1/b/"+slug+"/employee/"+emp+"/citas/"+ids[0]+"/pago",
			bytes.NewReader([]byte(body)))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		rec := httptest.NewRecorder()
		apiRouter(rec, req)
		return rec
	}

	// Sin token -> 401.
	if r := pago("emp1", `{"pagado":true}`, ""); r.Code != http.StatusUnauthorized {
		t.Fatalf("sin token code=%d, esperaba 401", r.Code)
	}
	// Payload inválido -> 400.
	if r := pago("emp1", `{}`, tok); r.Code != http.StatusBadRequest {
		t.Fatalf("sin pagado code=%d, esperaba 400", r.Code)
	}
	// Agenda ajena -> 403.
	tok2 := signEmployeeToken(slug, "emp2")
	if r := pago("emp2", `{"pagado":true}`, tok2); r.Code != http.StatusForbidden {
		t.Fatalf("ajeno code=%d, esperaba 403", r.Code)
	}
	// Marcar -> 200 + flag + CRM cobrado.
	marca := pago("emp1", `{"pagado":true}`, tok)
	if marca.Code != http.StatusOK {
		t.Fatalf("marcar code=%d body=%s, esperaba 200", marca.Code, marca.Body.String())
	}
	var out map[string]interface{}
	if err := json.Unmarshal(marca.Body.Bytes(), &out); err != nil || out["pagado"] != true {
		t.Fatalf("respuesta=%s, esperaba pagado:true", marca.Body.String())
	}
	doc, _ := firestoreClient.Collection("reservas").Doc(ids[0]).Get(ctx)
	var b Booking
	doc.DataTo(&b)
	if !b.Pagado {
		t.Fatalf("reserva sin flag pagado")
	}
	cli, _ := firestoreClient.Collection("clientes").Doc(clienteDocID(slug, "+573001111111")).Get(ctx)
	if p, _ := cli.Data()["paid_total"].(int64); p != 10000 {
		t.Fatalf("paid_total=%v, esperaba 10000", cli.Data()["paid_total"])
	}
	// Idempotente.
	if r := pago("emp1", `{"pagado":true}`, tok); r.Code != http.StatusOK {
		t.Fatalf("re-marcar code=%d, esperaba 200", r.Code)
	}
	// Desmarcar -> 200 + contador en 0.
	if r := pago("emp1", `{"pagado":false}`, tok); r.Code != http.StatusOK {
		t.Fatalf("desmarcar code=%d, esperaba 200", r.Code)
	}
	cli2, _ := firestoreClient.Collection("clientes").Doc(clienteDocID(slug, "+573001111111")).Get(ctx)
	if p, _ := cli2.Data()["paid_total"].(int64); p != 0 {
		t.Fatalf("paid_total=%v, esperaba 0", cli2.Data()["paid_total"])
	}
}

// El empleado deshace la cancelación de SU agenda aunque la cita no sea de
// hoy (ventana <24h de la acción); la ajena se rechaza.
func TestEmpleadoUndoPropiaAgenda(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-empundo")
	seedTienda(t, ctx, slug)
	code, _ := postBook(t, slug, map[string]string{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": mañanaStr(), "hora": "10:00",
		"clienteNombre": "Juan", "clienteTelefono": "+573002222222",
	})
	if code != http.StatusCreated {
		t.Fatalf("book code=%d, esperaba 201", code)
	}
	ids := reservaIDsPorTelefono(t, ctx, slug, "+573002222222")
	if len(ids) != 1 {
		t.Fatalf("reservas=%d, esperaba 1", len(ids))
	}
	tok := signEmployeeToken(slug, "emp1")
	conToken := func(emp, method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, bytes.NewReader([]byte(body)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+tok)
		_ = emp
		rec := httptest.NewRecorder()
		apiRouter(rec, req)
		return rec
	}
	// Cancela su propia cita (mañana, no hoy).
	del := conToken("emp1", http.MethodDelete, "/api/v1/b/"+slug+"/citas/"+ids[0], ``)
	if del.Code != http.StatusOK {
		t.Fatalf("cancel code=%d body=%s, esperaba 200", del.Code, del.Body.String())
	}
	// La lista expone la marca de acción para la ventana de deshacer.
	lreq := httptest.NewRequest(http.MethodGet, "/api/v1/b/"+slug+"/employee/emp1/citas", nil)
	lreq.Header.Set("Authorization", "Bearer "+tok)
	lrec := httptest.NewRecorder()
	apiRouter(lrec, lreq)
	if lrec.Code != http.StatusOK {
		t.Fatalf("citas code=%d, esperaba 200", lrec.Code)
	}
	var lista []map[string]interface{}
	if err := json.Unmarshal(lrec.Body.Bytes(), &lista); err != nil || len(lista) != 1 {
		t.Fatalf("lista=%s, esperaba 1 cita", lrec.Body.String())
	}
	if lista[0]["cancelled"] != true || lista[0]["cancelled_at"] == nil || lista[0]["cancelled_at"] == "" {
		t.Fatalf("cita=%v, esperaba cancelled + cancelled_at", lista[0])
	}
	// Deshace aunque no sea hoy.
	undo := conToken("emp1", http.MethodPost, "/api/v1/b/"+slug+"/citas/"+ids[0]+"/undo", `{}`)
	if undo.Code != http.StatusOK {
		t.Fatalf("undo code=%d body=%s, esperaba 200", undo.Code, undo.Body.String())
	}
	doc, _ := firestoreClient.Collection("reservas").Doc(ids[0]).Get(ctx)
	if doc.Data()["cancelled"] == true {
		t.Fatalf("sigue cancelada después del undo")
	}
	// Ajeno no puede deshacerla.
	tok2 := signEmployeeToken(slug, "emp2")
	areq := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/citas/"+ids[0]+"/undo", bytes.NewReader([]byte(`{}`)))
	areq.Header.Set("Content-Type", "application/json")
	areq.Header.Set("Authorization", "Bearer "+tok2)
	arec := httptest.NewRecorder()
	apiRouter(arec, areq)
	if arec.Code != http.StatusUnauthorized && arec.Code != http.StatusForbidden {
		t.Fatalf("ajeno code=%d, esperaba 401/403", arec.Code)
	}
}

// Libro mayor de cobrado-real: pagar → cancelar revierte → deshacer repone.
// Sin esto, el CRM diría que entró plata de citas que ya no existen.
func TestPagoCancelUndoLedger(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-ledger")
	seedTienda(t, ctx, slug)
	code, _ := postBook(t, slug, map[string]string{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": mañanaStr(), "hora": "10:00",
		"clienteNombre": "Juan", "clienteTelefono": "+573003333333",
	})
	if code != http.StatusCreated {
		t.Fatalf("book code=%d, esperaba 201", code)
	}
	ids := reservaIDsPorTelefono(t, ctx, slug, "+573003333333")
	if len(ids) != 1 {
		t.Fatalf("reservas=%d, esperaba 1", len(ids))
	}
	tok := signEmployeeToken(slug, "emp1")
	call := func(method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, bytes.NewReader([]byte(body)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		apiRouter(rec, req)
		return rec
	}
	cobrado := func() int64 {
		cli, _ := firestoreClient.Collection("clientes").Doc(clienteDocID(slug, "+573003333333")).Get(ctx)
		p, _ := cli.Data()["paid_total"].(int64)
		return p
	}
	if r := call(http.MethodPost, "/api/v1/b/"+slug+"/employee/emp1/citas/"+ids[0]+"/pago", `{"pagado":true}`); r.Code != http.StatusOK {
		t.Fatalf("pago code=%d, esperaba 200", r.Code)
	}
	if cobrado() != 10000 {
		t.Fatalf("cobrado tras pago, esperaba 10000")
	}
	if r := call(http.MethodDelete, "/api/v1/b/"+slug+"/citas/"+ids[0], ``); r.Code != http.StatusOK {
		t.Fatalf("cancel code=%d body=%s, esperaba 200", r.Code, r.Body.String())
	}
	if cobrado() != 0 {
		t.Fatalf("cobrado tras cancel, esperaba 0")
	}
	if r := call(http.MethodPost, "/api/v1/b/"+slug+"/citas/"+ids[0]+"/undo", `{}`); r.Code != http.StatusOK {
		t.Fatalf("undo code=%d body=%s, esperaba 200", r.Code, r.Body.String())
	}
	if cobrado() != 10000 {
		t.Fatalf("cobrado tras undo, esperaba 10000")
	}
	doc, _ := firestoreClient.Collection("reservas").Doc(ids[0]).Get(ctx)
	var b Booking
	doc.DataTo(&b)
	if !b.Pagado || doc.Data()["cancelled"] == true {
		t.Fatalf("estado final inconsistente: pagado=%v cancelled=%v", b.Pagado, doc.Data()["cancelled"])
	}
}

// Carrera por el último cupo: capacidad 2, cuatro reservas paralelas del
// mismo horario → exactamente 2 entran y 2 chocan (sin overbooking).
func TestRecursoCupoConcurrente(t *testing.T) {
	testFirestoreClient(t)
	ctx := context.Background()
	slug := slugUnico("test-cupconc")
	seedTienda(t, ctx, slug)
	seedRecursoCap(t, ctx, slug, "rec1", 2)
	_ = ctx
	fecha := mañanaStr()
	codes := make([]int, 4)
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			body, _ := json.Marshal(map[string]interface{}{
				"servicioId": "svc1", "recursoId": "rec1",
				"fecha": fecha, "hora": "10:00",
				"clienteNombre": "X", "clienteTelefono": fmt.Sprintf("+57300999010%d", i),
			})
			req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			authClienteUnico(t, req)
			rec := httptest.NewRecorder()
			bookHandler(rec, req, slug)
			codes[i] = rec.Code
		}(i)
	}
	wg.Wait()
	ok, conflict := 0, 0
	for _, c := range codes {
		switch c {
		case http.StatusCreated:
			ok++
		case http.StatusConflict:
			conflict++
		default:
			t.Fatalf("code inesperado=%d", c)
		}
	}
	if ok != 2 || conflict != 2 {
		t.Fatalf("ok=%d conflict=%d, esperaba 2/2", ok, conflict)
	}
}

func TestClienteLoginObligatorioYUID(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-login")
	seedTienda(t, ctx, slug)
	fecha := mañanaStr()
	tok := tokenClienteTest(t, "cliente@test.com")

	// Sin token -> 401 login_requerido.
	body, _ := json.Marshal(map[string]interface{}{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": fecha, "hora": "10:00",
		"clienteNombre": "X", "clienteTelefono": "+573001111111",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	bookHandler(rec, req, slug)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("sin token code=%d, esperaba 401", rec.Code)
	}

	// Con token -> 201 y guarda client_uid.
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("Authorization", "Bearer "+tok)
	rec2 := httptest.NewRecorder()
	bookHandler(rec2, req2, slug)
	if rec2.Code != http.StatusCreated {
		t.Fatalf("con token code=%d body=%s, esperaba 201", rec2.Code, rec2.Body.String())
	}
	ids := reservaIDsPorTelefono(t, ctx, slug, "+573001111111")
	if len(ids) != 1 {
		t.Fatalf("reservas=%d", len(ids))
	}
	doc, _ := firestoreClient.Collection("reservas").Doc(ids[0]).Get(ctx)
	var b Booking
	doc.DataTo(&b)
	if b.ClientUID == "" {
		t.Fatal("client_uid vacío, debía guardarse del token")
	}

	// MisCitas con token -> la ve.
	lreq := httptest.NewRequest(http.MethodGet, "/api/v1/b/"+slug+"/citas", nil)
	lreq.Header.Set("Authorization", "Bearer "+tok)
	lrec := httptest.NewRecorder()
	listCitasHandler(lrec, lreq, slug)
	if lrec.Code != http.StatusOK {
		t.Fatalf("citas con token code=%d, esperaba 200", lrec.Code)
	}
	var citas []map[string]interface{}
	_ = json.Unmarshal(lrec.Body.Bytes(), &citas)
	if len(citas) != 1 {
		t.Fatalf("citas=%d, esperaba 1", len(citas))
	}

	// MisCitas por teléfono -> 401 (vía eliminada: solo sesión).
	preq := httptest.NewRequest(http.MethodGet, "/api/v1/b/"+slug+"/citas?telefono=+573001111111", nil)
	prec := httptest.NewRecorder()
	listCitasHandler(prec, preq, slug)
	if prec.Code != http.StatusUnauthorized {
		t.Fatalf("citas por teléfono code=%d, esperaba 401", prec.Code)
	}
}

func TestTopeDiarioPorUID(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-topeuid")
	seedTienda(t, ctx, slug)
	fecha := mañanaStr()
	tok := tokenClienteTest(t, "cliente@test.com")

	book := func(phone, hora string) int {
		body, _ := json.Marshal(map[string]interface{}{
			"servicioId": "svc1", "empleadoId": "emp1",
			"fecha": fecha, "hora": hora,
			"clienteNombre": "X", "clienteTelefono": phone,
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		bookHandler(rec, req, slug)
		return rec.Code
	}

	// Tope default 3: tres citas con DISTINTO teléfono entran (misma cuenta).
	for i, h := range []string{"10:00", "11:00", "12:00"} {
		if c := book(fmt.Sprintf("+57300999990%d", i), h); c != http.StatusCreated {
			t.Fatalf("cita %d code=%d body, esperaba 201 (rotar número no debía importar)", i+1, c)
		}
	}
	// 4ta con otro número distinto: el tope por UID la frena.
	if c := book("+573009999903", "13:00"); c != http.StatusConflict {
		t.Fatalf("4ta cita code=%d, esperaba 409 por tope UID", c)
	}
}

func TestCitaUIDSoloTokenLaToca(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-uidlock")
	seedTienda(t, ctx, slug)
	// +2 días: fuera de la ventana de 24h para que el cliente pueda mover.
	fecha := time.Now().Add(48 * time.Hour).Format("2006-01-02")
	tok := tokenClienteTest(t, "lock@test.com")
	phone := "+573007777771"

	// Reserva con sesión (queda con UID).
	body, _ := json.Marshal(map[string]interface{}{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": fecha, "hora": "10:00",
		"clienteNombre": "X", "clienteTelefono": phone,
	})
	br := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
	br.Header.Set("Content-Type", "application/json")
	br.Header.Set("Authorization", "Bearer "+tok)
	brec := httptest.NewRecorder()
	bookHandler(brec, br, slug)
	if brec.Code != http.StatusCreated {
		t.Fatalf("book code=%d, esperaba 201", brec.Code)
	}
	ids := reservaIDsPorTelefono(t, ctx, slug, phone)
	if len(ids) != 1 {
		t.Fatalf("reservas=%d", len(ids))
	}
	citaID := ids[0]

	// Atacante con solo el teléfono: cancelar -> 403, mover -> 403.
	cr := httptest.NewRequest(http.MethodDelete, "/api/v1/b/"+slug+"/citas/"+citaID, nil)
	cr.Header.Set("X-Client-Phone", phone)
	crec := httptest.NewRecorder()
	cancelCitaHandler(crec, cr, slug, citaID)
	if crec.Code != http.StatusForbidden {
		t.Fatalf("cancel con teléfono code=%d, esperaba 403", crec.Code)
	}
	mr := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/citas/"+citaID+"/reschedule",
		bytes.NewReader([]byte(`{"fecha":"`+fecha+`","hora":"11:00"}`)))
	mr.Header.Set("Content-Type", "application/json")
	mr.Header.Set("X-Client-Phone", phone)
	mrec := httptest.NewRecorder()
	rescheduleCitaHandler(mrec, mr, slug, citaID)
	if mrec.Code != http.StatusForbidden {
		t.Fatalf("mover con teléfono code=%d, esperaba 403", mrec.Code)
	}

	// Dueño de la cita con token: mover -> 200, cancelar -> 200.
	mr2 := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/citas/"+citaID+"/reschedule",
		bytes.NewReader([]byte(`{"fecha":"`+fecha+`","hora":"11:00"}`)))
	mr2.Header.Set("Content-Type", "application/json")
	mr2.Header.Set("Authorization", "Bearer "+tok)
	mrec2 := httptest.NewRecorder()
	rescheduleCitaHandler(mrec2, mr2, slug, citaID)
	if mrec2.Code != http.StatusOK {
		t.Fatalf("mover con token code=%d body=%s, esperaba 200", mrec2.Code, mrec2.Body.String())
	}
	cr2 := httptest.NewRequest(http.MethodDelete, "/api/v1/b/"+slug+"/citas/"+citaID, nil)
	cr2.Header.Set("Authorization", "Bearer "+tok)
	crec2 := httptest.NewRecorder()
	cancelCitaHandler(crec2, cr2, slug, citaID)
	if crec2.Code != http.StatusOK {
		t.Fatalf("cancel con token code=%d body=%s, esperaba 200", crec2.Code, crec2.Body.String())
	}
}

func TestBookDuenoConSesionGuardaUID(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-owneruid")
	seedTienda(t, ctx, slug)
	// El dueño es el usuario de prueba: su token pasa isOwnerRequest.
	uid := clienteUIDTest(t, "dueno@test.com")
	tok := tokenClienteTest(t, "dueno@test.com")
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Set(ctx, map[string]interface{}{
		"owner_uid": uid,
	}, firestore.MergeAll); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]interface{}{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": mañanaStr(), "hora": "10:00",
		"clienteNombre": "Dueño", "clienteTelefono": "+573006666661",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	bookHandler(rec, req, slug)
	if rec.Code != http.StatusCreated {
		t.Fatalf("book dueño code=%d body=%s, esperaba 201", rec.Code, rec.Body.String())
	}
	ids := reservaIDsPorTelefono(t, ctx, slug, "+573006666661")
	if len(ids) != 1 {
		t.Fatalf("reservas=%d", len(ids))
	}
	doc, _ := firestoreClient.Collection("reservas").Doc(ids[0]).Get(ctx)
	var b Booking
	doc.DataTo(&b)
	if b.ClientUID != uid {
		t.Fatalf("client_uid=%q, esperaba el del dueño %q (MisCitas lo necesita)", b.ClientUID, uid)
	}
}

func TestBookPanelDuenoYEmpleado(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-panel")
	seedTienda(t, ctx, slug)
	fecha := mañanaStr()

	panelBook := func(auth, body map[string]interface{}) int {
		if body == nil {
			body = map[string]interface{}{}
		}
		b, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		if tok, ok := auth["token"].(string); ok {
			req.Header.Set("Authorization", "Bearer "+tok)
		}
		rec := httptest.NewRecorder()
		bookHandler(rec, req, slug)
		return rec.Code
	}
	base := func() map[string]interface{} {
		return map[string]interface{}{
			"servicioId": "svc1", "empleadoId": "emp1",
			"fecha": fecha, "hora": "10:00",
			"clienteNombre": "Walk", "clienteTelefono": "+573002222221",
			"origen": "panel",
		}
	}

	// Panel sin sesión -> 401.
	if c := panelBook(nil, base()); c != http.StatusUnauthorized {
		t.Fatalf("panel sin token code=%d, esperaba 401", c)
	}

	// Dueño con sesión: 201 y SIN UID (es del cliente anotado).
	duenoUID := clienteUIDTest(t, "duenopanel@test.com")
	duenoTok := tokenClienteTest(t, "duenopanel@test.com")
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Set(ctx, map[string]interface{}{
		"owner_uid": duenoUID,
	}, firestore.MergeAll); err != nil {
		t.Fatal(err)
	}
	b1 := base()
	b1["hora"] = "10:00"
	if c := panelBook(map[string]interface{}{"token": duenoTok}, b1); c != http.StatusCreated {
		t.Fatalf("panel dueño code=%d, esperaba 201", c)
	}
	ids := reservaIDsPorTelefono(t, ctx, slug, "+573002222221")
	if len(ids) != 1 {
		t.Fatalf("reservas=%d", len(ids))
	}
	doc, _ := firestoreClient.Collection("reservas").Doc(ids[0]).Get(ctx)
	var b Booking
	doc.DataTo(&b)
	if b.ClientUID != "" {
		t.Fatalf("client_uid=%q, el panel no adjunta UID", b.ClientUID)
	}

	// Empleado en su agenda: 201.
	empTok := signEmployeeToken(slug, "emp1")
	b2 := base()
	b2["hora"] = "11:00"
	b2["clienteTelefono"] = "+573002222222"
	if c := panelBook(map[string]interface{}{"token": empTok}, b2); c != http.StatusCreated {
		t.Fatalf("panel empleado propio code=%d, esperaba 201", c)
	}

	// Empleado en agenda ajena: 403.
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Collection("empleados").Doc("emp2").Set(ctx, map[string]interface{}{"name": "Luis"}); err != nil {
		t.Fatal(err)
	}
	b3 := base()
	b3["hora"] = "12:00"
	b3["empleadoId"] = "emp2"
	b3["clienteTelefono"] = "+573002222223"
	if c := panelBook(map[string]interface{}{"token": empTok}, b3); c != http.StatusForbidden {
		t.Fatalf("panel empleado ajeno code=%d, esperaba 403", c)
	}
}

func TestMoverRespetaTopeUID(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-movetope")
	seedTienda(t, ctx, slug)
	fechaA := time.Now().Add(48 * time.Hour).Format("2006-01-02")
	fechaB := time.Now().Add(72 * time.Hour).Format("2006-01-02")
	tok := tokenClienteTest(t, "movetope@test.com")

	bookUID := func(phone, fecha, hora string) int {
		body, _ := json.Marshal(map[string]interface{}{
			"servicioId": "svc1", "empleadoId": "emp1",
			"fecha": fecha, "hora": hora,
			"clienteNombre": "X", "clienteTelefono": phone,
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		bookHandler(rec, req, slug)
		return rec.Code
	}
	// Llena el tope (3) el día A con números rotados.
	for i, h := range []string{"10:00", "11:00", "12:00"} {
		if c := bookUID(fmt.Sprintf("+57300111001%d", i), fechaA, h); c != http.StatusCreated {
			t.Fatalf("llenado %d code=%d, esperaba 201", i+1, c)
		}
	}
	// Una el día B.
	if c := bookUID("+573001110019", fechaB, "10:00"); c != http.StatusCreated {
		t.Fatalf("día B code=%d, esperaba 201", c)
	}
	ids := reservaIDsPorTelefono(t, ctx, slug, "+573001110019")
	if len(ids) != 1 {
		t.Fatalf("reservas=%d", len(ids))
	}
	// Moverla al día A (lleno por UID) -> 409.
	mr := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/citas/"+ids[0]+"/reschedule",
		bytes.NewReader([]byte(`{"fecha":"`+fechaA+`","hora":"13:00"}`)))
	mr.Header.Set("Content-Type", "application/json")
	mr.Header.Set("Authorization", "Bearer "+tok)
	mrec := httptest.NewRecorder()
	rescheduleCitaHandler(mrec, mr, slug, ids[0])
	if mrec.Code != http.StatusConflict {
		t.Fatalf("mover a día lleno code=%d body=%s, esperaba 409", mrec.Code, mrec.Body.String())
	}
}


func TestUnLugarPorPersonaYSesion(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-unlugar")
	seedTienda(t, ctx, slug)
	seedRecurso(t, ctx, slug, "rec1", "Cancha 1")
	fecha := mañanaStr()
	tok := tokenClienteTest(t, "unlugar@test.com")

	bookUID := func(phone, hora string) int {
		body, _ := json.Marshal(map[string]interface{}{
			"servicioId": "svc1", "recursoId": "rec1",
			"fecha": fecha, "hora": hora,
			"clienteNombre": "X", "clienteTelefono": phone,
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		bookHandler(rec, req, slug)
		return rec.Code
	}
	// Primera: entra.
	if c := bookUID("+573002222221", "10:00"); c != http.StatusCreated {
		t.Fatalf("primera code=%d, esperaba 201", c)
	}
	// Misma sesión, otro número: duplicado -> 409.
	if c := bookUID("+573002222229", "10:00"); c != http.StatusConflict {
		t.Fatalf("duplicada code=%d body, esperaba 409", c)
	}
	// Otra hora: libre.
	if c := bookUID("+573002222221", "11:00"); c != http.StatusCreated {
		t.Fatalf("otra hora code=%d, esperaba 201", c)
	}
}

func TestOAuthConSesionYEstadoCalendar(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-oauth")
	seedTienda(t, ctx, slug)

	// Sin sesión -> 401 (cierra la revinculación abierta).
	req := httptest.NewRequest(http.MethodGet, "/auth/google/login?negocio_id="+slug+"&emp_id=emp1", nil)
	rec := httptest.NewRecorder()
	googleLoginHandler(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("sin sesión code=%d, esperaba 401", rec.Code)
	}
	// Token de OTRO empleado -> 401.
	otroTok := signEmployeeToken(slug, "emp2")
	req2 := httptest.NewRequest(http.MethodGet, "/auth/google/login?negocio_id="+slug+"&emp_id=emp1&tok="+otroTok, nil)
	rec2 := httptest.NewRecorder()
	googleLoginHandler(rec2, req2)
	if rec2.Code != http.StatusUnauthorized {
		t.Fatalf("token ajeno code=%d, esperaba 401", rec2.Code)
	}
	// Token propio -> redirect a Google (307). Requiere config OAuth (en prod
	// la pone main; aquí una mínima).
	googleOauthCfg = &oauth2.Config{
		ClientID: "test-id", RedirectURL: "http://localhost/cb",
		Scopes:   []string{"https://www.googleapis.com/auth/calendar"},
		Endpoint: google.Endpoint,
	}
	miTok := signEmployeeToken(slug, "emp1")
	req3 := httptest.NewRequest(http.MethodGet, "/auth/google/login?negocio_id="+slug+"&emp_id=emp1&tok="+miTok+"&ret=emp", nil)
	rec3 := httptest.NewRecorder()
	googleLoginHandler(rec3, req3)
	if rec3.Code != http.StatusTemporaryRedirect {
		t.Fatalf("token propio code=%d, esperaba 307", rec3.Code)
	}
	if loc := rec3.Header().Get("Location"); loc == "" || !strings.Contains(loc, "accounts.google.com") {
		t.Fatalf("sin redirect a Google: %q", loc)
	}

	// Estado calendar sin conectar -> false.
	req4 := httptest.NewRequest(http.MethodGet, "/api/v1/b/"+slug+"/employee/emp1/calendar-status", nil)
	req4.Header.Set("Authorization", "Bearer "+miTok)
	rec4 := httptest.NewRecorder()
	employeeCalendarStatusHandler(rec4, req4, slug, "emp1")
	if rec4.Code != http.StatusOK {
		t.Fatalf("status code=%d, esperaba 200", rec4.Code)
	}
	var out map[string]interface{}
	_ = json.Unmarshal(rec4.Body.Bytes(), &out)
	if con, _ := out["conectado"].(bool); con {
		t.Fatal("conectado=true sin vincular")
	}
}

// Instructor en espacios: bloqueo cruzado clase<->1-a-1 en ambas direcciones.
func TestEspacioInstructorBloqueo(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-instr")
	seedTienda(t, ctx, slug)
	_, err := firestoreClient.Collection("negocios").Doc(slug).Collection("recursos").Doc("rec1").Set(ctx, map[string]interface{}{
		"name": "Clase Yoga", "tipo": "clase", "capacidad": 5,
		"duration_minutes": 60, "price": "0", "instructor_id": "emp1",
	})
	if err != nil {
		t.Fatal(err)
	}
	fecha := mañanaStr()
	slotsDe := func(q string) []string {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/b/"+slug+"/slots?"+q, nil)
		rec := httptest.NewRecorder()
		getSlotsHandler(rec, req, slug)
		if rec.Code != http.StatusOK {
			t.Fatalf("slots %s code=%d, esperaba 200", q, rec.Code)
		}
		var arr []string
		if err := json.Unmarshal(rec.Body.Bytes(), &arr); err == nil {
			return arr
		}
		var obj struct {
			Slots []string `json:"slots"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &obj); err != nil {
			t.Fatalf("slots %s respuesta ilegible: %s", q, rec.Body.String())
		}
		return obj.Slots
	}
	contiene := func(slots []string, h string) bool {
		for _, s := range slots {
			if s == h {
				return true
			}
		}
		return false
	}
	reservar := func(payload map[string]interface{}) int {
		body, _ := json.Marshal(payload)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		authClienteUnico(t, req)
		rec := httptest.NewRecorder()
		bookHandler(rec, req, slug)
		return rec.Code
	}

	// 1-a-1 con Ana 10:00-10:30.
	if c := reservar(map[string]interface{}{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": fecha, "hora": "10:00",
		"clienteNombre": "X", "clienteTelefono": "+573004444441",
	}); c != http.StatusCreated {
		t.Fatalf("book 1-a-1 code=%d, esperaba 201", c)
	}
	// La sesión de Yoga 10:00 desaparece (instructora ocupada), 11:00 sigue.
	esp := slotsDe("recurso_id=rec1&fecha=" + fecha + "&cupos=1")
	if contiene(esp, "10:00") {
		t.Fatalf("sesión 10:00 ofrecida con instructora ocupada: %v", esp)
	}
	if !contiene(esp, "11:00") {
		t.Fatalf("sesión 11:00 ausente sin motivo: %v", esp)
	}
	// Viceversa: sesión 09:00 bloquea 09:00 y 09:30 del 1-a-1, no las 10:30.
	if c := reservar(map[string]interface{}{
		"recursoId": "rec1",
		"fecha": fecha, "hora": "09:00",
		"clienteNombre": "Y", "clienteTelefono": "+573004444442",
	}); c != http.StatusCreated {
		t.Fatalf("book sesión code=%d, esperaba 201", c)
	}
	emp := slotsDe("emp_id=emp1&servicio_id=svc1&fecha=" + fecha)
	if contiene(emp, "09:00") || contiene(emp, "09:30") {
		t.Fatalf("1-a-1 ofrecido durante la clase: %v", emp)
	}
	if !contiene(emp, "10:30") {
		t.Fatalf("10:30 ausente sin motivo: %v", emp)
	}
}

// Instructor en espacios: visible en su portal, marca pago y se sustituye.
func TestEspacioInstructorPortalYPago(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-instrportal")
	seedTienda(t, ctx, slug)
	_, err := firestoreClient.Collection("negocios").Doc(slug).Collection("recursos").Doc("rec1").Set(ctx, map[string]interface{}{
		"name": "Clase Yoga", "tipo": "clase", "capacidad": 5,
		"duration_minutes": 60, "price": "20000", "instructor_id": "emp1",
	})
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]interface{}{
		"recursoId": "rec1",
		"fecha": mañanaStr(), "hora": "11:00",
		"clienteNombre": "Z", "clienteTelefono": "+573005555555",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	authClienteUnico(t, req)
	rec := httptest.NewRecorder()
	bookHandler(rec, req, slug)
	if rec.Code != http.StatusCreated {
		t.Fatalf("book sesión code=%d body=%s, esperaba 201", rec.Code, rec.Body.String())
	}
	tok := signEmployeeToken(slug, "emp1")
	verCitas := func(token string) []map[string]interface{} {
		lreq := httptest.NewRequest(http.MethodGet, "/api/v1/b/"+slug+"/employee/emp1/citas", nil)
		lreq.Header.Set("Authorization", "Bearer "+token)
		lrec := httptest.NewRecorder()
		apiRouter(lrec, lreq)
		if lrec.Code != http.StatusOK {
			t.Fatalf("citas code=%d, esperaba 200", lrec.Code)
		}
		var lista []map[string]interface{}
		if err := json.Unmarshal(lrec.Body.Bytes(), &lista); err != nil {
			t.Fatal(err)
		}
		return lista
	}
	lista := verCitas(tok)
	if len(lista) != 1 || lista[0]["recurso"] != "Clase Yoga" {
		t.Fatalf("portal sin la sesión: %v", lista)
	}
	ids := reservaIDsPorTelefono(t, ctx, slug, "+573005555555")
	pagoReq := httptest.NewRequest(http.MethodPost,
		"/api/v1/b/"+slug+"/employee/emp1/citas/"+ids[0]+"/pago",
		bytes.NewReader([]byte(`{"pagado":true}`)))
	pagoReq.Header.Set("Content-Type", "application/json")
	pagoReq.Header.Set("Authorization", "Bearer "+tok)
	pagoRec := httptest.NewRecorder()
	apiRouter(pagoRec, pagoReq)
	if pagoRec.Code != http.StatusOK {
		t.Fatalf("pago instructor code=%d body=%s, esperaba 200", pagoRec.Code, pagoRec.Body.String())
	}
	cli, _ := firestoreClient.Collection("clientes").Doc(clienteDocID(slug, "+573005555555")).Get(ctx)
	if p, _ := cli.Data()["paid_total"].(int64); p != 20000 {
		t.Fatalf("paid_total=%v, esperaba 20000", cli.Data()["paid_total"])
	}
	// Sustitución: pasa a emp2, sale del portal de emp1 y entra al de emp2.
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Collection("recursos").Doc("rec1").Set(ctx, map[string]interface{}{
		"instructor_id": "emp2",
	}, firestore.MergeAll); err != nil {
		t.Fatal(err)
	}
	if l := verCitas(tok); len(l) != 0 {
		t.Fatalf("emp1 aún ve la sesión tras sustitución: %v", l)
	}
	tok2 := signEmployeeToken(slug, "emp2")
	lreq := httptest.NewRequest(http.MethodGet, "/api/v1/b/"+slug+"/employee/emp2/citas", nil)
	lreq.Header.Set("Authorization", "Bearer "+tok2)
	lrec := httptest.NewRecorder()
	apiRouter(lrec, lreq)
	if lrec.Code != http.StatusOK {
		t.Fatalf("citas emp2 code=%d, esperaba 200", lrec.Code)
	}
	var lista2 []map[string]interface{}
	if err := json.Unmarshal(lrec.Body.Bytes(), &lista2); err != nil || len(lista2) != 1 {
		t.Fatalf("emp2 no ve la sesión: %s", lrec.Body.String())
	}
}

// Crear espacio con instructor inexistente se rechaza; con válido pasa.
func TestCrearRecursoValidaInstructor(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-recinstr")
	seedTienda(t, ctx, slug)
	duenoUID := clienteUIDTest(t, "duenorecinstr@test.com")
	duenoTok := tokenClienteTest(t, "duenorecinstr@test.com")
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Set(ctx, map[string]interface{}{
		"owner_uid": duenoUID,
	}, firestore.MergeAll); err != nil {
		t.Fatal(err)
	}
	crear := func(payload string) int {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/recursos", bytes.NewReader([]byte(payload)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+duenoTok)
		rec := httptest.NewRecorder()
		apiRouter(rec, req)
		return rec.Code
	}
	if c := crear(`{"name":"X","tipo":"clase","capacidad":5,"instructor_id":"nadie"}`); c != http.StatusBadRequest {
		t.Fatalf("instructor fantasma code=%d, esperaba 400", c)
	}
	if c := crear(`{"name":"Yoga","tipo":"clase","capacidad":5,"duration_minutes":90,"price":25000,"instructor_id":"emp1"}`); c != http.StatusCreated {
		t.Fatalf("instructor válido code=%d, esperaba 201", c)
	}
}

// Salud del servicio.
func TestHealth(t *testing.T) {
	testFirestoreClient(t)
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	healthHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("health code=%d, esperaba 200", rec.Code)
	}
}

// El negocio público expone precio/duración/instructor del espacio
// (lo que pinta "con Ana" en la reserva sin otro llamado).
func TestGetNegocioExponeInstructor(t *testing.T) {
	testFirestoreClient(t)
	ctx := context.Background()
	slug := slugUnico("test-pub")
	seedTienda(t, ctx, slug)
	_, err := firestoreClient.Collection("negocios").Doc(slug).Collection("recursos").Doc("rec1").Set(ctx, map[string]interface{}{
		"name": "Clase Yoga", "tipo": "clase", "capacidad": 5,
		"duration_minutes": 90, "price": "25000", "instructor_id": "emp1",
	})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/b/"+slug, nil)
	rec := httptest.NewRecorder()
	getNegocioHandler(rec, req, slug)
	if rec.Code != http.StatusOK {
		t.Fatalf("negocio code=%d, esperaba 200", rec.Code)
	}
	var out struct {
		Recursos []map[string]interface{} `json:"recursos"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || len(out.Recursos) != 1 {
		t.Fatalf("recursos=%s, esperaba 1", rec.Body.String())
	}
	r := out.Recursos[0]
	if r["instructor_id"] != "emp1" || r["price"] != "25000" {
		t.Fatalf("recurso=%v, esperaba instructor/price", r)
	}
	if d, _ := r["duration_minutes"].(float64); d != 90 {
		t.Fatalf("duration=%v, esperaba 90", r["duration_minutes"])
	}
}

// Primer hueco: responde fecha/hora y salta la hora bloqueada por el instructor.
func TestPrimerHueco(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-hueco")
	seedTienda(t, ctx, slug)
	_, err := firestoreClient.Collection("negocios").Doc(slug).Collection("recursos").Doc("rec1").Set(ctx, map[string]interface{}{
		"name": "Clase Yoga", "tipo": "clase", "capacidad": 5,
		"duration_minutes": 60, "price": "0", "instructor_id": "emp1",
	})
	if err != nil {
		t.Fatal(err)
	}
	hueco := func(q string) (int, map[string]interface{}) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/b/"+slug+"/slots/primer-hueco?"+q, nil)
		rec := httptest.NewRecorder()
		apiRouter(rec, req)
		var out map[string]interface{}
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}
	code, out := hueco("servicio_id=svc1&emp_id=emp1")
	if code != http.StatusOK || out["fecha"] == nil || out["hora"] == nil {
		t.Fatalf("hueco servicio code=%d out=%v", code, out)
	}
	// Ana ocupada 10:00-10:30 en 1-a-1: la sesión de 60 de las 10:00 no sale.
	body, _ := json.Marshal(map[string]interface{}{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": mañanaStr(), "hora": "10:00",
		"clienteNombre": "X", "clienteTelefono": "+573006666661",
	})
	breq := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
	breq.Header.Set("Content-Type", "application/json")
	authClienteUnico(t, breq)
	brec := httptest.NewRecorder()
	bookHandler(brec, breq, slug)
	if brec.Code != http.StatusCreated {
		t.Fatalf("book code=%d, esperaba 201", brec.Code)
	}
	code2, out2 := hueco("recurso_id=rec1&cupos=1")
	if code2 != http.StatusOK {
		t.Fatalf("hueco espacio code=%d, esperaba 200", code2)
	}
	if out2["fecha"] == mañanaStr() && out2["hora"] == "10:00" {
		t.Fatalf("hueco=%v, las 10:00 debían saltarse (instructora ocupada)", out2)
	}
}

// Borrar espacio: 409 con citas futuras activas, 200 al liberar.
func TestDeleteRecursoConCitasFuturas(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-delrec")
	seedTienda(t, ctx, slug)
	_, err := firestoreClient.Collection("negocios").Doc(slug).Collection("recursos").Doc("rec1").Set(ctx, map[string]interface{}{
		"name": "Cancha", "tipo": "cancha", "capacidad": 4,
	})
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]interface{}{
		"recursoId": "rec1",
		"fecha": mañanaStr(), "hora": "10:00",
		"clienteNombre": "X", "clienteTelefono": "+573007777771",
	})
	breq := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
	breq.Header.Set("Content-Type", "application/json")
	authClienteUnico(t, breq)
	brec := httptest.NewRecorder()
	bookHandler(brec, breq, slug)
	if brec.Code != http.StatusCreated {
		t.Fatalf("book code=%d, esperaba 201", brec.Code)
	}
	duenoUID := clienteUIDTest(t, "duenodelrec@test.com")
	duenoTok := tokenClienteTest(t, "duenodelrec@test.com")
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Set(ctx, map[string]interface{}{
		"owner_uid": duenoUID,
	}, firestore.MergeAll); err != nil {
		t.Fatal(err)
	}
	borrar := func() int {
		req := httptest.NewRequest(http.MethodDelete, "/api/v1/b/"+slug+"/recursos/rec1", nil)
		req.Header.Set("Authorization", "Bearer "+duenoTok)
		rec := httptest.NewRecorder()
		apiRouter(rec, req)
		return rec.Code
	}
	if c := borrar(); c != http.StatusConflict {
		t.Fatalf("con citas code=%d, esperaba 409", c)
	}
	ids := reservaIDsPorTelefono(t, ctx, slug, "+573007777771")
	creq := httptest.NewRequest(http.MethodDelete, "/api/v1/b/"+slug+"/citas/"+ids[0], nil)
	creq.Header.Set("Authorization", "Bearer "+duenoTok)
	crec := httptest.NewRecorder()
	apiRouter(crec, creq)
	if crec.Code != http.StatusOK {
		t.Fatalf("cancel code=%d, esperaba 200", crec.Code)
	}
	if c := borrar(); c != http.StatusOK {
		t.Fatalf("libre code=%d, esperaba 200", c)
	}
}

// Servicios CRUD del dueño: actualiza precio/duración y elimina.
func TestUpdateDeleteServicio(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-svc")
	seedTienda(t, ctx, slug)
	duenoUID := clienteUIDTest(t, "duenosvc@test.com")
	duenoTok := tokenClienteTest(t, "duenosvc@test.com")
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Set(ctx, map[string]interface{}{
		"owner_uid": duenoUID,
	}, firestore.MergeAll); err != nil {
		t.Fatal(err)
	}
	call := func(method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, bytes.NewReader([]byte(body)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+duenoTok)
		rec := httptest.NewRecorder()
		apiRouter(rec, req)
		return rec
	}
	put := call(http.MethodPut, "/api/v1/b/"+slug+"/servicios/svc1", `{"duration_minutes":45,"price":"15000"}`)
	if put.Code != http.StatusOK {
		t.Fatalf("update code=%d body=%s, esperaba 200", put.Code, put.Body.String())
	}
	doc, _ := firestoreClient.Collection("negocios").Doc(slug).Collection("servicios").Doc("svc1").Get(ctx)
	if doc.Data()["price"] != "15000" {
		t.Fatalf("price=%v, esperaba 15000", doc.Data()["price"])
	}
	sinAuth := httptest.NewRequest(http.MethodPut, "/api/v1/b/"+slug+"/servicios/svc1", bytes.NewReader([]byte(`{"price":"1"}`)))
	sinAuth.Header.Set("Content-Type", "application/json")
	sinRec := httptest.NewRecorder()
	apiRouter(sinRec, sinAuth)
	if sinRec.Code != http.StatusUnauthorized {
		t.Fatalf("sin token code=%d, esperaba 401", sinRec.Code)
	}
	del := call(http.MethodDelete, "/api/v1/b/"+slug+"/servicios/svc1", ``)
	if del.Code != http.StatusOK {
		t.Fatalf("delete code=%d body=%s, esperaba 200", del.Code, del.Body.String())
	}
}

// Reglas puras (sin emulador): horarios, marca y zona horaria.
func TestReglasHorarioYMarca(t *testing.T) {
	h := &HorarioSemanal{Lunes: DiaHorario{Activo: true, Turnos: []Turno{{Inicio: "09:00", Fin: "13:00"}}}}
	if d := employeeDayHorario(h, time.Monday); d == nil || !d.Activo || len(d.Turnos) != 1 {
		t.Fatalf("lunes=%v, esperaba turno activo", d)
	}
	if d := employeeDayHorario(h, time.Tuesday); d == nil || d.Activo {
		t.Fatalf("martes=%v, día inactivo debe venir apagado", d)
	}
	if d := employeeDayHorario(nil, time.Monday); d != nil {
		t.Fatalf("sin horario=%v, debe ser nil", d)
	}
	for _, c := range []string{"", "#16A34A", "#abcdef"} {
		if !esColorMarcaValido(c) {
			t.Fatalf("color %q debía ser válido", c)
		}
	}
	for _, c := range []string{"rojo", "#12345", "1234567", "#GGGGGG"} {
		if esColorMarcaValido(c) {
			t.Fatalf("color %q debía ser inválido", c)
		}
	}
	m := sanearMarca(Marca{Color: "  #123456  ", Eslogan: strings.Repeat("x", 100), Instagram: "@juan"})
	if m.Color != "#123456" {
		t.Fatalf("color=%q", m.Color)
	}
	if len([]rune(m.Eslogan)) != 80 {
		t.Fatalf("eslogan len=%d, esperaba 80", len([]rune(m.Eslogan)))
	}
	if m.Instagram != "@juan" {
		t.Fatalf("instagram=%q", m.Instagram)
	}
	if m2 := sanearMarca(Marca{Color: "no-es-color"}); m2.Color != "" {
		t.Fatalf("color inválido=%q, debía limpiarse", m2.Color)
	}
	if loc := bogotaLocation(); loc.String() != "America/Bogota" && loc.String() != "BOT" {
		t.Fatalf("zona=%q", loc.String())
	}
}

// Borrar profesional: 409 con citas futuras, 200 al liberar (cascada).
func TestDeleteEmpleadoConYSinCitas(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-delemp")
	seedTienda(t, ctx, slug)
	code, _ := postBook(t, slug, map[string]string{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": mañanaStr(), "hora": "10:00",
		"clienteNombre": "Juan", "clienteTelefono": "+573008888881",
	})
	if code != http.StatusCreated {
		t.Fatalf("book code=%d, esperaba 201", code)
	}
	duenoUID := clienteUIDTest(t, "duenodelemp@test.com")
	duenoTok := tokenClienteTest(t, "duenodelemp@test.com")
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Set(ctx, map[string]interface{}{
		"owner_uid": duenoUID,
	}, firestore.MergeAll); err != nil {
		t.Fatal(err)
	}
	borrar := func() int {
		req := httptest.NewRequest(http.MethodDelete, "/api/v1/b/"+slug+"/empleados/emp1", nil)
		req.Header.Set("Authorization", "Bearer "+duenoTok)
		rec := httptest.NewRecorder()
		apiRouter(rec, req)
		return rec.Code
	}
	if c := borrar(); c != http.StatusConflict {
		t.Fatalf("con citas code=%d, esperaba 409", c)
	}
	ids := reservaIDsPorTelefono(t, ctx, slug, "+573008888881")
	creq := httptest.NewRequest(http.MethodDelete, "/api/v1/b/"+slug+"/citas/"+ids[0], nil)
	creq.Header.Set("Authorization", "Bearer "+duenoTok)
	crec := httptest.NewRecorder()
	apiRouter(crec, creq)
	if crec.Code != http.StatusOK {
		t.Fatalf("cancel code=%d, esperaba 200", crec.Code)
	}
	if c := borrar(); c != http.StatusOK {
		t.Fatalf("libre code=%d, esperaba 200", c)
	}
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Collection("empleados").Doc("emp1").Get(ctx); err == nil {
		t.Fatalf("el empleado sigue existiendo")
	}
}

// Primer hueco por profesional y día cerrado sin oferta.
func TestPrimerHuecoEmpleadoYDiaCerrado(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-huecoemp")
	seedTienda(t, ctx, slug)
	hueco := func(q string) (int, map[string]interface{}) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/b/"+slug+"/slots/primer-hueco?"+q, nil)
		rec := httptest.NewRecorder()
		apiRouter(rec, req)
		var out map[string]interface{}
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}
	code, out := hueco("servicio_id=svc1&emp_id=emp1")
	if code != http.StatusOK || out["fecha"] == nil || out["hora"] == nil {
		t.Fatalf("hueco emp code=%d out=%v", code, out)
	}
	codeAny, outAny := hueco("servicio_id=svc1&emp_id=any")
	if codeAny != http.StatusOK || outAny["hora"] == nil {
		t.Fatalf("hueco any code=%d out=%v", codeAny, outAny)
	}
	// Empleado con semana cerrada: 404 sin huecos.
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Collection("empleados").Doc("emp1").Set(ctx, map[string]interface{}{
		"horario": map[string]interface{}{
			"lunes": map[string]interface{}{"activo": false}, "martes": map[string]interface{}{"activo": false},
			"miercoles": map[string]interface{}{"activo": false}, "jueves": map[string]interface{}{"activo": false},
			"viernes": map[string]interface{}{"activo": false}, "sabado": map[string]interface{}{"activo": false},
			"domingo": map[string]interface{}{"activo": false},
		},
	}, firestore.MergeAll); err != nil {
		t.Fatal(err)
	}
	negocioCache.Invalidate(slug)
	codeCerr, _ := hueco("servicio_id=svc1&emp_id=emp1")
	if codeCerr != http.StatusNotFound {
		t.Fatalf("día cerrado code=%d, esperaba 404", codeCerr)
	}
}

// Middleware: CORS, cabeceras de seguridad y límite de peticiones.
func TestMiddlewareSeguridadYLimite(t *testing.T) {
	ok := func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusTeapot) }
	// Preflight CORS con origen permitido.
	pre := httptest.NewRequest(http.MethodOptions, "/", nil)
	pre.Header.Set("Origin", "https://turnobot-web.web.app")
	prerec := httptest.NewRecorder()
	corsMiddleware(ok)(prerec, pre)
	if prerec.Code != http.StatusOK {
		t.Fatalf("preflight code=%d, esperaba 200", prerec.Code)
	}
	if prerec.Header().Get("Access-Control-Allow-Origin") != "https://turnobot-web.web.app" {
		t.Fatalf("sin eco de origen permitido")
	}
	// Origen ajeno: pasa pero sin eco.
	otro := httptest.NewRequest(http.MethodGet, "/", nil)
	otro.Header.Set("Origin", "https://malo.example")
	otrorec := httptest.NewRecorder()
	corsMiddleware(ok)(otrorec, otro)
	if otrorec.Code != http.StatusTeapot || otrorec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("origen ajeno code=%d eco=%q", otrorec.Code, otrorec.Header().Get("Access-Control-Allow-Origin"))
	}
	// Cabeceras de seguridad presentes.
	sec := httptest.NewRequest(http.MethodGet, "/", nil)
	secrec := httptest.NewRecorder()
	securityHeadersMiddleware(ok)(secrec, sec)
	for _, h := range []string{"X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"} {
		if secrec.Header().Get(h) == "" {
			t.Fatalf("falta cabecera %s", h)
		}
	}
	// Límite: 2 pasan, la 3a se frena con 429.
	rl := &rateLimiter{visitors: map[string]*visitor{}, limit: 2, window: time.Minute}
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = "9.9.9.9:1234"
		rec := httptest.NewRecorder()
		rateLimitMiddleware(rl, ok)(rec, req)
		if rec.Code != http.StatusTeapot {
			t.Fatalf("petición %d code=%d, esperaba 418", i+1, rec.Code)
		}
	}
	req3 := httptest.NewRequest(http.MethodGet, "/", nil)
	req3.RemoteAddr = "9.9.9.9:1234"
	rec3 := httptest.NewRecorder()
	rateLimitMiddleware(rl, ok)(rec3, req3)
	if rec3.Code != http.StatusTooManyRequests {
		t.Fatalf("exceso code=%d, esperaba 429", rec3.Code)
	}
}

// Registro de token push del dueño: auth y validaciones.
func TestPushTokenRegistro(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-push")
	seedTienda(t, ctx, slug)
	duenoUID := clienteUIDTest(t, "duenopush@test.com")
	duenoTok := tokenClienteTest(t, "duenopush@test.com")
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Set(ctx, map[string]interface{}{
		"owner_uid": duenoUID,
	}, firestore.MergeAll); err != nil {
		t.Fatal(err)
	}
	call := func(tok, body string) int {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/register-push-token", bytes.NewReader([]byte(body)))
		req.Header.Set("Content-Type", "application/json")
		if tok != "" {
			req.Header.Set("Authorization", "Bearer "+tok)
		}
		rec := httptest.NewRecorder()
		apiRouter(rec, req)
		return rec.Code
	}
	if c := call("", `{"token":"abc"}`); c != http.StatusUnauthorized {
		t.Fatalf("sin token code=%d, esperaba 401", c)
	}
	if c := call(duenoTok, `{"token":""}`); c != http.StatusBadRequest {
		t.Fatalf("vacío code=%d, esperaba 400", c)
	}
	if c := call(duenoTok, `{"token":"`+strings.Repeat("x", 600)+`"}`); c != http.StatusBadRequest {
		t.Fatalf("largo code=%d, esperaba 400", c)
	}
	if c := call(duenoTok, `{"token":"fcm-test-123"}`); c != http.StatusOK {
		t.Fatalf("válido code=%d, esperaba 200", c)
	}
}

// Mover sobre horario ocupado se rechaza; a hueco libre pasa.
func TestMoverSlotOcupadoYLibre(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-mover")
	seedTienda(t, ctx, slug)
	duenoUID := clienteUIDTest(t, "duenomover@test.com")
	duenoTok := tokenClienteTest(t, "duenomover@test.com")
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Set(ctx, map[string]interface{}{
		"owner_uid": duenoUID,
	}, firestore.MergeAll); err != nil {
		t.Fatal(err)
	}
	book := func(phone, hora string) {
		body, _ := json.Marshal(map[string]interface{}{
			"servicioId": "svc1", "empleadoId": "emp1",
			"fecha": mañanaStr(), "hora": hora,
			"clienteNombre": "X", "clienteTelefono": phone,
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		authClienteUnico(t, req)
		rec := httptest.NewRecorder()
		bookHandler(rec, req, slug)
		if rec.Code != http.StatusCreated {
			t.Fatalf("book %s code=%d, esperaba 201", hora, rec.Code)
		}
	}
	book("+573001010101", "10:00")
	book("+573001010102", "10:30")
	ids := reservaIDsPorTelefono(t, ctx, slug, "+573001010101")
	mover := func(hora string) int {
		body, _ := json.Marshal(map[string]string{"fecha": mañanaStr(), "hora": hora})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/citas/"+ids[0]+"/reschedule", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+duenoTok)
		rec := httptest.NewRecorder()
		apiRouter(rec, req)
		return rec.Code
	}
	if c := mover("10:30"); c != http.StatusConflict {
		t.Fatalf("mover ocupado code=%d, esperaba 409", c)
	}
	if c := mover("11:00"); c != http.StatusOK {
		t.Fatalf("mover libre code=%d, esperaba 200", c)
	}
}

// ─── Regresión P0: integridad de espacios (instructor en tx, reschedule,
// ventana de cupos) ───

// bookRaw reserva con un cliente nuevo por llamado (login obligatorio; el
// usuario único evita el tope diario por UID entre llamadas) y devuelve el código.
func bookRaw(t *testing.T, slug string, payload map[string]interface{}) int {
	t.Helper()
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	authClienteUnico(t, req)
	rec := httptest.NewRecorder()
	bookHandler(rec, req, slug)
	return rec.Code
}

// seedInstructor crea un recurso tipo clase con instructor emp1.
func seedInstructor(t *testing.T, ctx context.Context, slug, id string) {
	t.Helper()
	_, err := firestoreClient.Collection("negocios").Doc(slug).Collection("recursos").Doc(id).Set(ctx, map[string]interface{}{
		"name": "Clase Yoga", "tipo": "clase", "capacidad": 5,
		"duration_minutes": 60, "price": "0", "instructor_id": "emp1",
	})
	if err != nil {
		t.Fatal(err)
	}
}

// P0-1: el bloqueo del instructor se verifica DENTRO de la transacción.
// Una cita 1-a-1 de emp1 a las 10:00 y una sesión de su clase a las 10:00
// no pueden confirmarse ambas, aunque el pre-check de lectura las viera libres.
func TestInstructorBloqueoDentroTx(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-instr-tx")
	seedTienda(t, ctx, slug)
	seedInstructor(t, ctx, slug, "rec1")

	// La cita directa de emp1 (agenda 1-a-1) a las 10:00.
	if c := bookRaw(t, slug, map[string]interface{}{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": mañanaStr(), "hora": "10:00",
		"clienteNombre": "Directo", "clienteTelefono": "+573004440001",
	}); c != http.StatusCreated {
		t.Fatalf("cita directa code=%d, esperaba 201", c)
	}

	// La sesión del espacio con el MISMO instructor a la MISMA hora → 409.
	if c := bookRaw(t, slug, map[string]interface{}{
		"recursoId": "rec1",
		"fecha":     mañanaStr(), "hora": "10:00",
		"clienteNombre": "Sesion", "clienteTelefono": "+573004440002",
	}); c != http.StatusConflict {
		t.Fatalf("sesión con instructor ocupado code=%d, esperaba 409", c)
	}

	// Otra hora → 201.
	if c := bookRaw(t, slug, map[string]interface{}{
		"recursoId": "rec1",
		"fecha":     mañanaStr(), "hora": "11:00",
		"clienteNombre": "Sesion", "clienteTelefono": "+573004440002",
	}); c != http.StatusCreated {
		t.Fatalf("sesión en hora libre code=%d, esperaba 201", c)
	}
}

// P0-3: la ventana de consulta de verificarCuposTx cubre el día completo.
// Un espacio con duración propia de 240 min (reserva 09:00-13:00) sobre
// capacidad 1 debe bloquear el candidato de 11:00, aunque empezó >2h antes
// (la ventana -2h anterior lo dejaba pasar y sobrevendía el espacio).
func TestCupoVentanaDiaCompleto(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-cupo-largo")
	seedTienda(t, ctx, slug)
	// Espacio exclusivo (cap 1) con duración propia de 240 min.
	_, err := firestoreClient.Collection("negocios").Doc(slug).Collection("recursos").Doc("rec1").Set(ctx, map[string]interface{}{
		"name": "Cancha larga", "tipo": "cancha", "capacidad": 1,
		"duration_minutes": 240, "price": "0",
	})
	if err != nil {
		t.Fatal(err)
	}
	// La reserva hereda la duración del espacio: 09:00-13:00.
	if c := bookRaw(t, slug, map[string]interface{}{
		"recursoId": "rec1",
		"fecha":     mañanaStr(), "hora": "09:00",
		"clienteNombre": "Larga", "clienteTelefono": "+573004440003",
	}); c != http.StatusCreated {
		t.Fatalf("reserva larga code=%d, esperaba 201", c)
	}

	// 11:00 cae DENTRO de la reserva larga (09:00-13:00): debe chocar.
	if c := bookRaw(t, slug, map[string]interface{}{
		"recursoId": "rec1",
		"fecha":     mañanaStr(), "hora": "11:00",
		"clienteNombre": "Corto", "clienteTelefono": "+573004440004",
	}); c != http.StatusConflict {
		t.Fatalf("candidato dentro de reserva larga code=%d, esperaba 409", c)
	}
	// 13:00 (fin exacto de la reserva larga, [inicio,fin)) → libre.
	if c := bookRaw(t, slug, map[string]interface{}{
		"recursoId": "rec1",
		"fecha":     mañanaStr(), "hora": "13:00",
		"clienteNombre": "Corto", "clienteTelefono": "+573004440004",
	}); c != http.StatusCreated {
		t.Fatalf("candidato tras fin code=%d, esperaba 201", c)
	}
}

// P0-2: reschedule re-verifica cupos dentro de su transacción. Dos citas de
// otro espacio movidas en paralelo al ÚLTIMO cupo de una sesión: solo una gana.
func TestRescheduleConcurrenteUltimoCupo(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-mover-cupo")
	seedTienda(t, ctx, slug)
	duenoUID := clienteUIDTest(t, "duenomovercupo@test.com")
	duenoTok := tokenClienteTest(t, "duenomovercupo@test.com")
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Set(ctx, map[string]interface{}{
		"owner_uid": duenoUID,
	}, firestore.MergeAll); err != nil {
		t.Fatal(err)
	}
	seedRecursoCap(t, ctx, slug, "reclleno", 1)

	// Sesión a las 15:00 (el destino, único cupo).
	if c := bookRaw(t, slug, map[string]interface{}{
		"recursoId": "reclleno",
		"fecha":     mañanaStr(), "hora": "15:00",
		"clienteNombre": "Ocupa", "clienteTelefono": "+573004440005",
	}); c != http.StatusCreated {
		t.Fatalf("sesión destino code=%d, esperaba 201", c)
	}
	// Dos citas de OTRO espacio (horas distintas para no chocar entre sí)
	// a mover en paralelo a las 15:00.
	seedRecursoCap(t, ctx, slug, "reccancha", 1)
	ids := []string{}
	horasOrigen := []string{"10:00", "11:00"}
	for i, ph := range []string{"+573004440006", "+573004440007"} {
		if c := bookRaw(t, slug, map[string]interface{}{
			"recursoId": "reccancha",
			"fecha":     mañanaStr(), "hora": horasOrigen[i],
			"clienteNombre": "Mover" + ph, "clienteTelefono": ph,
		}); c != http.StatusCreated {
			t.Fatalf("cita origen %s code=%d, esperaba 201", ph, c)
		}
		found := reservaIDsPorTelefono(t, ctx, slug, ph)
		if len(found) == 0 {
			t.Fatalf("cita origen %s no quedó en reservas", ph)
		}
		ids = append(ids, found[len(found)-1])
	}

	type res struct{ code int }
	ch := make(chan res, 2)
	for _, id := range ids {
		go func(id string) {
			body, _ := json.Marshal(map[string]string{"fecha": mañanaStr(), "hora": "15:00"})
			req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/citas/"+id+"/reschedule", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer "+duenoTok)
			rec := httptest.NewRecorder()
			rescheduleCitaHandler(rec, req, slug, id)
			ch <- res{rec.Code}
		}(id)
	}
	ganaron, perdieron := 0, 0
	for i := 0; i < 2; i++ {
		r := <-ch
		if r.code == http.StatusOK {
			ganaron++
		} else {
			perdieron++
		}
	}
	if ganaron != 1 || perdieron != 1 {
		t.Fatalf("reschedule concurrente: ganaron=%d perdieron=%d, esperaba 1/1", ganaron, perdieron)
	}
}

// Flujo simple: POST /recursos acepta horario semanal validado.
func TestCrearRecursoConHorario(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-rechor")
	seedTienda(t, ctx, slug)
	duenoUID := clienteUIDTest(t, "duenorechor@test.com")
	duenoTok := tokenClienteTest(t, "duenorechor@test.com")
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Set(ctx, map[string]interface{}{
		"owner_uid": duenoUID,
	}, firestore.MergeAll); err != nil {
		t.Fatal(err)
	}
	crear := func(payload string) (int, []byte) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/recursos", bytes.NewReader([]byte(payload)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+duenoTok)
		rec := httptest.NewRecorder()
		apiRouter(rec, req)
		return rec.Code, rec.Body.Bytes()
	}
	// Horario válido → 201 y el doc guarda el horario.
	code, _ := crear(`{"name":"Zumba","tipo":"clase","capacidad":10,"duration_minutes":60,"price":15000,
		"horario":{"lunes":{"activo":true,"turnos":[{"inicio":"10:00","fin":"12:00"}]},"martes":{"activo":false,"turnos":[]},
		"miercoles":{"activo":false,"turnos":[]},"jueves":{"activo":false,"turnos":[]},"viernes":{"activo":false,"turnos":[]},
		"sabado":{"activo":false,"turnos":[]},"domingo":{"activo":false,"turnos":[]}}}`)
	if code != http.StatusCreated {
		t.Fatalf("con horario code=%d, esperaba 201", code)
	}
	docs, _ := firestoreClient.Collection("negocios").Doc(slug).Collection("recursos").Where("name", "==", "Zumba").Documents(ctx).GetAll()
	if len(docs) != 1 {
		t.Fatalf("Zumba creada=%d, esperaba 1", len(docs))
	}
	if docs[0].Data()["horario"] == nil {
		t.Fatal("horario no guardado en el doc")
	}
	// Turno invertido → 400.
	code, _ = crear(`{"name":"Mal","tipo":"clase","capacidad":5,
		"horario":{"lunes":{"activo":true,"turnos":[{"inicio":"12:00","fin":"10:00"}]},"martes":{"activo":false,"turnos":[]},
		"miercoles":{"activo":false,"turnos":[]},"jueves":{"activo":false,"turnos":[]},"viernes":{"activo":false,"turnos":[]},
		"sabado":{"activo":false,"turnos":[]},"domingo":{"activo":false,"turnos":[]}}}`)
	if code != http.StatusBadRequest {
		t.Fatalf("horario inválido code=%d, esperaba 400", code)
	}
	// Sin horario → 201 (jornada del negocio) y doc SIN campo horario.
	code, _ = crear(`{"name":"Simple","tipo":"cancha","capacidad":2}`)
	if code != http.StatusCreated {
		t.Fatalf("sin horario code=%d, esperaba 201", code)
	}
	docs, _ = firestoreClient.Collection("negocios").Doc(slug).Collection("recursos").Where("name", "==", "Simple").Documents(ctx).GetAll()
	if len(docs) != 1 {
		t.Fatal("Simple no creada")
	}
	if _, ok := docs[0].Data()["horario"]; ok {
		t.Fatal("horario no debió escribirse si no vino en el payload")
	}
}

// Escenario del dueño: "para una clase específica uso Horario propio y defino
// que esta clase solo se dicta los viernes de 14:00 a 16:00". Se crea la
// clase por POST /recursos con ese horario y se verifica que la rejilla solo
// ofrece slots del viernes 14:00-16:00 (y que reservar fuera de esa franja
// se rechaza en transacción).
func TestClaseSoloViernes1400a1600(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-viernes")
	seedTienda(t, ctx, slug)
	duenoUID := clienteUIDTest(t, "duenoviernes@test.com")
	duenoTok := tokenClienteTest(t, "duenoviernes@test.com")
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Set(ctx, map[string]interface{}{
		"owner_uid": duenoUID,
	}, firestore.MergeAll); err != nil {
		t.Fatal(err)
	}

	// 1. Crear la clase con horario propio: solo viernes 14:00-16:00.
	payload := `{"name":"Clase Viernes","tipo":"clase","capacidad":5,"duration_minutes":60,"price":20000,
		"horario":{"lunes":{"activo":false,"turnos":[]},"martes":{"activo":false,"turnos":[]},
		"miercoles":{"activo":false,"turnos":[]},"jueves":{"activo":false,"turnos":[]},
		"viernes":{"activo":true,"turnos":[{"inicio":"14:00","fin":"16:00"}]},
		"sabado":{"activo":false,"turnos":[]},"domingo":{"activo":false,"turnos":[]}}}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/recursos", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+duenoTok)
	rec := httptest.NewRecorder()
	apiRouter(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("crear clase code=%d, esperaba 201", rec.Code)
	}
	var creada struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &creada); err != nil || creada.ID == "" {
		t.Fatalf("respuesta sin id: %s", rec.Body.String())
	}

	// 2. El próximo viernes de la semana que viene: la clase ofrece 14:00 y 15:00.
	viernes := proximoDia(t, time.Friday)
	slots, _, err := disponibilidadRecurso(ctx, slug, creada.ID, viernes, 60, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(slots) != 2 || slots[0] != "14:00" || slots[1] != "15:00" {
		t.Fatalf("slots viernes=%v, esperaba [14:00 15:00]", slots)
	}

	// 3. El sábado siguiente NO ofrece nada (día cerrado en el horario propio).
	sabado := proximoDia(t, time.Saturday)
	slotsSab, _, err := disponibilidadRecurso(ctx, slug, creada.ID, sabado, 60, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(slotsSab) != 0 {
		t.Fatalf("slots sábado=%v, esperaba vacío", slotsSab)
	}

	// 4. La transacción de /book también respeta el horario propio: un
	// intento de reserva el sábado se rechaza (409 slot_taken).
	if c := bookRaw(t, slug, map[string]interface{}{
		"recursoId": creada.ID,
		"fecha":     sabado.Format("2006-01-02"), "hora": "14:00",
		"clienteNombre": "Fuera", "clienteTelefono": "+573004440008",
	}); c != http.StatusConflict {
		t.Fatalf("reserva sábado code=%d, esperaba 409", c)
	}
}

// proximoDia devuelve la fecha (en Bogotá) del próximo día de semana dado,
// siempre al menos 2 días en el futuro para respetar la antelación mínima.
func proximoDia(t *testing.T, dia time.Weekday) time.Time {
	t.Helper()
	loc, err := time.LoadLocation("America/Bogota")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().In(loc)
	for i := 2; i <= 9; i++ {
		d := now.AddDate(0, 0, i)
		if d.Weekday() == dia {
			return d
		}
	}
	t.Fatal("no se encontró el día buscado en los próximos 9 días")
	return time.Time{}
}
