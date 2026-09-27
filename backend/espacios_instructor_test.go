package main

// Batería espacios × horarios × instructores: Escudo Preventivo (T1),
// Bloqueo Duro (T2), cancelación de sesión (T3), bloqueo inverso, cupos,
// reschedule y validación de horarios. Corre contra emuladores locales
// (Firestore 8090 + Auth 9099); sin ellos se omite como el resto del repo.
import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"cloud.google.com/go/firestore"
)

// setupEspacioTest crea tienda + dueño y retorna slug y token del dueño.
func setupEspacioTest(t *testing.T, ctx context.Context, base, duenoEmail string) (string, string) {
	t.Helper()
	slug := slugUnico(base)
	seedTienda(t, ctx, slug)
	duenoUID := clienteUIDTest(t, duenoEmail)
	duenoTok := tokenClienteTest(t, duenoEmail)
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Set(ctx, map[string]interface{}{
		"owner_uid": duenoUID,
	}, firestore.MergeAll); err != nil {
		t.Fatal(err)
	}
	return slug, duenoTok
}

// postRecursoTest crea un espacio vía API. Retorna código y cuerpo.
func postRecursoTest(t *testing.T, slug, duenoTok, payload string) (int, map[string]interface{}) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/recursos", bytes.NewReader([]byte(payload)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+duenoTok)
	rec := httptest.NewRecorder()
	apiRouter(rec, req)
	var out map[string]interface{}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

// slotsListaTest consulta slots y retorna la lista plana (array u objeto).
func slotsListaTest(t *testing.T, slug, q string) []string {
	t.Helper()
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
		t.Fatalf("slots %s ilegible: %s", q, rec.Body.String())
	}
	return obj.Slots
}

// contieneHora dice si la hora está en la lista.
func contieneHora(slots []string, h string) bool {
	for _, s := range slots {
		if s == h {
			return true
		}
	}
	return false
}

// bookSesionTest reserva un cupo en el recurso con cliente único.
func bookSesionTest(t *testing.T, slug, recID, fecha, hora, phone string) int {
	t.Helper()
	body, _ := json.Marshal(map[string]interface{}{
		"recursoId": recID,
		"fecha": fecha, "hora": hora,
		"clienteNombre": "Alu", "clienteTelefono": phone,
		"clientePushToken": "fake-tok-" + phone,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	authClienteUnico(t, req)
	rec := httptest.NewRecorder()
	bookHandler(rec, req, slug)
	return rec.Code
}

// horarioDiaJSON arma {"dia":{"activo":true,"turnos":[...]}} para un solo día.
func horarioDiaJSON(dia, inicio, fin string) string {
	return fmt.Sprintf(`{%q:{"activo":true,"turnos":[{"inicio":%q,"fin":%q}]}}`, dia, inicio, fin)
}

// claveManana retorna la fecha de mañana y su clave de día (Bogotá).
func claveManana() (string, string) {
	bog, _ := time.LoadLocation("America/Bogota")
	manana := time.Now().In(bog).Add(24 * time.Hour)
	return manana.Format("2006-01-02"), diaClaveES(manana.Weekday())
}

// fechaProximoDia retorna el próximo YYYY-MM-DD con ese weekday (Bogotá,
// siempre futuro, mínimo mañana).
func fechaProximoDia(wd time.Weekday) string {
	bog, _ := time.LoadLocation("America/Bogota")
	base := time.Now().In(bog)
	for i := 1; i <= 7; i++ {
		d := base.Add(time.Duration(i*24) * time.Hour)
		if d.Weekday() == wd {
			return d.Format("2006-01-02")
		}
	}
	return ""
}

// ─── T1: Escudo Preventivo ───

// Sin horario propio no hay bloqueo de pie: instructor + flexible → 201.
func TestEscudoFlexibleSinHorarioPasa(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug, duenoTok := setupEspacioTest(t, ctx, "test-escflex", "escflex@test.com")
	fecha, _ := claveManana()
	code, _ := postBook(t, slug, map[string]string{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": fecha, "hora": "10:00",
		"clienteNombre": "X", "clienteTelefono": "+573008881111",
	})
	if code != http.StatusCreated {
		t.Fatalf("book code=%d, esperaba 201", code)
	}
	c, _ := postRecursoTest(t, slug, duenoTok,
		`{"name":"Cancha","tipo":"cancha","capacidad":4,"duration_minutes":60,"instructor_id":"emp1"}`)
	if c != http.StatusCreated {
		t.Fatalf("flexible code=%d, esperaba 201", c)
	}
}

// Con horario pero sin instructor no hay a quién chocar → 201.
func TestEscudoHorarioSinInstructorPasa(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug, duenoTok := setupEspacioTest(t, ctx, "test-escsin", "escsin@test.com")
	fecha, clave := claveManana()
	code, _ := postBook(t, slug, map[string]string{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": fecha, "hora": "10:00",
		"clienteNombre": "X", "clienteTelefono": "+573008882222",
	})
	if code != http.StatusCreated {
		t.Fatalf("book code=%d, esperaba 201", code)
	}
	c, _ := postRecursoTest(t, slug, duenoTok,
		fmt.Sprintf(`{"name":"Sala","tipo":"sala","capacidad":6,"duration_minutes":60,"horario":%s}`, horarioDiaJSON(clave, "09:00", "11:00")))
	if c != http.StatusCreated {
		t.Fatalf("sin instructor code=%d, esperaba 201", c)
	}
}

// Una cita 1-a-1 ya cancelada no frena la creación → 201.
func TestEscudoIgnoraCanceladas(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug, duenoTok := setupEspacioTest(t, ctx, "test-esccanc", "esccanc@test.com")
	fecha, clave := claveManana()
	phone := "+573008883333"
	code, out := postBook(t, slug, map[string]string{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": fecha, "hora": "10:00",
		"clienteNombre": "X", "clienteTelefono": phone,
	})
	if code != http.StatusCreated {
		t.Fatalf("book code=%d, esperaba 201", code)
	}
	citaID, _ := out["cita_id"].(string)
	// Dueño la cancela.
	creq := httptest.NewRequest(http.MethodDelete, "/api/v1/b/"+slug+"/citas/"+citaID, nil)
	creq.Header.Set("Authorization", "Bearer "+duenoTok)
	crec := httptest.NewRecorder()
	apiRouter(crec, creq)
	if crec.Code != http.StatusOK {
		t.Fatalf("cancel code=%d, esperaba 200", crec.Code)
	}
	c, _ := postRecursoTest(t, slug, duenoTok,
		fmt.Sprintf(`{"name":"Funcional","tipo":"clase","capacidad":15,"duration_minutes":60,"instructor_id":"emp1","horario":%s}`, horarioDiaJSON(clave, "09:00", "11:00")))
	if c != http.StatusCreated {
		t.Fatalf("con cancelada code=%d, esperaba 201", c)
	}
}

// Reservas pasadas no cuentan para el escudo (horario mira al futuro).
func TestEscudoIgnoraPasadas(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug, duenoTok := setupEspacioTest(t, ctx, "test-escpas", "escpas@test.com")
	bog, _ := time.LoadLocation("America/Bogota")
	ayer := time.Now().In(bog).Add(-24 * time.Hour)
	clave := diaClaveES(ayer.Weekday())
	// Reserva pasada insertada directo (la API no deja reservar atrás).
	_, err := firestoreClient.Collection("reservas").NewDoc().Set(ctx, map[string]interface{}{
		"negocio_id": slug, "owner_uid": "owner-test", "emp_id": "emp1",
		"user_phone": "+573008884444", "client_name": "Viejo",
		"service_name": "Corte", "duration_minutes": 30, "price": 10000,
		"date_time": time.Date(ayer.Year(), ayer.Month(), ayer.Day(), 10, 0, 0, 0, bog),
		"created_at": time.Now(), "cancelled": false,
	})
	if err != nil {
		t.Fatal(err)
	}
	c, _ := postRecursoTest(t, slug, duenoTok,
		fmt.Sprintf(`{"name":"Funcional","tipo":"clase","capacidad":15,"duration_minutes":60,"instructor_id":"emp1","horario":%s}`, horarioDiaJSON(clave, "09:00", "11:00")))
	if c != http.StatusCreated {
		t.Fatalf("con pasada code=%d, esperaba 201", c)
	}
}

// Mismo día pero turnos sin solape (10:00-10:30 vs 11:00-12:00) → 201.
func TestEscudoMismoDiaSinSolapePasa(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug, duenoTok := setupEspacioTest(t, ctx, "test-escsol", "escsol@test.com")
	fecha, clave := claveManana()
	code, _ := postBook(t, slug, map[string]string{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": fecha, "hora": "10:00",
		"clienteNombre": "X", "clienteTelefono": "+573008885555",
	})
	if code != http.StatusCreated {
		t.Fatalf("book code=%d, esperaba 201", code)
	}
	c, _ := postRecursoTest(t, slug, duenoTok,
		fmt.Sprintf(`{"name":"Tarde","tipo":"clase","capacidad":10,"duration_minutes":60,"instructor_id":"emp1","horario":%s}`, horarioDiaJSON(clave, "11:00", "12:00")))
	if c != http.StatusCreated {
		t.Fatalf("sin solape code=%d, esperaba 201", c)
	}
}

// Horario inválido (fin antes que inicio) → 400 horario_invalido.
func TestEscudoHorarioInvalido400(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug, duenoTok := setupEspacioTest(t, ctx, "test-escinv", "escinv@test.com")
	c, out := postRecursoTest(t, slug, duenoTok,
		`{"name":"Mala","tipo":"clase","capacidad":5,"duration_minutes":60,"instructor_id":"emp1","horario":{"lunes":{"activo":true,"turnos":[{"inicio":"18:00","fin":"09:00"}]}}}`)
	if c != http.StatusBadRequest || out["error"] != "horario_invalido" {
		t.Fatalf("code=%d out=%v, esperaba 400 horario_invalido", c, out)
	}
}

// ─── T2: Bloqueo Duro ───

// Clase solo-viernes bloquea el viernes y deja el lunes intacto.
func TestDuroSoloEseDia(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug, duenoTok := setupEspacioTest(t, ctx, "test-durodia", "durodia@test.com")
	vie := fechaProximoDia(time.Friday)
	lun := fechaProximoDia(time.Monday)
	c, _ := postRecursoTest(t, slug, duenoTok,
		`{"name":"Viernes Fit","tipo":"clase","capacidad":10,"duration_minutes":60,"instructor_id":"emp1","horario":{"viernes":{"activo":true,"turnos":[{"inicio":"09:00","fin":"18:00"}]}}}`)
	if c != http.StatusCreated {
		t.Fatalf("crear code=%d, esperaba 201", c)
	}
	if emp := slotsListaTest(t, slug, "emp_id=emp1&servicio_id=svc1&fecha="+vie); len(emp) != 0 {
		t.Fatalf("viernes con clase: %v, esperaba vacío", emp)
	}
	if emp := slotsListaTest(t, slug, "emp_id=emp1&servicio_id=svc1&fecha="+lun); len(emp) == 0 {
		t.Fatalf("lunes sin clase vacío, esperaba slots")
	}
}

// Recurso flexible (sin horario) con instructor NO bloquea el 1-a-1.
func TestDuroFlexibleNoBloquea(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug, duenoTok := setupEspacioTest(t, ctx, "test-duroflex", "duroflex@test.com")
	c, _ := postRecursoTest(t, slug, duenoTok,
		`{"name":"Cancha","tipo":"cancha","capacidad":4,"duration_minutes":60,"instructor_id":"emp1"}`)
	if c != http.StatusCreated {
		t.Fatalf("crear code=%d, esperaba 201", c)
	}
	fecha, _ := claveManana()
	if emp := slotsListaTest(t, slug, "emp_id=emp1&servicio_id=svc1&fecha="+fecha); !contieneHora(emp, "10:00") {
		t.Fatalf("10:00 ausente con espacio flexible: %v", emp)
	}
}

// La clase de emp1 no afecta a emp2.
func TestDuroNoAfectaOtroInstructor(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug, duenoTok := setupEspacioTest(t, ctx, "test-durootro", "durootro@test.com")
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Collection("empleados").Doc("emp2").Set(ctx, map[string]interface{}{
		"name": "Luis",
	}); err != nil {
		t.Fatal(err)
	}
	fecha, clave := claveManana()
	c, _ := postRecursoTest(t, slug, duenoTok,
		fmt.Sprintf(`{"name":"Fit","tipo":"clase","capacidad":10,"duration_minutes":60,"instructor_id":"emp1","horario":%s}`, horarioDiaJSON(clave, "09:00", "18:00")))
	if c != http.StatusCreated {
		t.Fatalf("crear code=%d, esperaba 201", c)
	}
	if emp := slotsListaTest(t, slug, "emp_id=emp1&servicio_id=svc1&fecha="+fecha); len(emp) != 0 {
		t.Fatalf("emp1 con clase: %v, esperaba vacío", emp)
	}
	if emp := slotsListaTest(t, slug, "emp_id=emp2&servicio_id=svc1&fecha="+fecha); !contieneHora(emp, "10:00") {
		t.Fatalf("emp2 bloqueado por clase ajena: %v", emp)
	}
}

// Primer hueco salta el bloqueo duro (clase 09-12: hueco desde las 12:00).
func TestDuroPrimerHuecoSaltaBloqueo(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug, duenoTok := setupEspacioTest(t, ctx, "test-durohueco", "durohueco@test.com")
	fecha, clave := claveManana()
	c, _ := postRecursoTest(t, slug, duenoTok,
		fmt.Sprintf(`{"name":"Mañana Fit","tipo":"clase","capacidad":10,"duration_minutes":60,"instructor_id":"emp1","horario":%s}`, horarioDiaJSON(clave, "09:00", "12:00")))
	if c != http.StatusCreated {
		t.Fatalf("crear code=%d, esperaba 201", c)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/b/"+slug+"/slots/primer-hueco?servicio_id=svc1&emp_id=emp1", nil)
	rec := httptest.NewRecorder()
	apiRouter(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("hueco code=%d, esperaba 200", rec.Code)
	}
	var out map[string]interface{}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	// El hueco puede ser hoy (día sin bloqueo); si cae mañana, debe saltar
	// el bloque 09-12 de la clase. Nunca en el pasado.
	bog, _ := time.LoadLocation("America/Bogota")
	hoy := time.Now().In(bog).Format("2006-01-02")
	f, _ := out["fecha"].(string)
	if f < hoy {
		t.Fatalf("hueco=%v en el pasado", out)
	}
	if f == fecha {
		if h, _ := out["hora"].(string); h < "12:00" {
			t.Fatalf("hueco=%v, las 09-12 de mañana están bloqueadas", out)
		}
	}
}

// Reservar 1-a-1 directo en horario de clase → 409 slot_taken.
func TestBookDirectoEnBloqueo409(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug, duenoTok := setupEspacioTest(t, ctx, "test-bookblq", "bookblq@test.com")
	fecha, clave := claveManana()
	c, _ := postRecursoTest(t, slug, duenoTok,
		fmt.Sprintf(`{"name":"Fit","tipo":"clase","capacidad":10,"duration_minutes":60,"instructor_id":"emp1","horario":%s}`, horarioDiaJSON(clave, "09:00", "18:00")))
	if c != http.StatusCreated {
		t.Fatalf("crear code=%d, esperaba 201", c)
	}
	code, out := postBook(t, slug, map[string]string{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": fecha, "hora": "10:00",
		"clienteNombre": "X", "clienteTelefono": "+573008886666",
	})
	if code != http.StatusConflict || out["error"] != "slot_taken" {
		t.Fatalf("code=%d out=%v, esperaba 409 slot_taken", code, out)
	}
}

// ─── T3: cancelación de sesión ───

// Sesión sin inscritos se responde 200 con ceros.
func TestSesionSinInscritos(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug, duenoTok := setupEspacioTest(t, ctx, "test-sesvacia", "sesvacia@test.com")
	c, out := postRecursoTest(t, slug, duenoTok,
		`{"name":"Fit","tipo":"clase","capacidad":5,"duration_minutes":60,"instructor_id":"emp1"}`)
	if c != http.StatusCreated {
		t.Fatalf("crear code=%d, esperaba 201", c)
	}
	recID, _ := out["id"].(string)
	fecha, _ := claveManana()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/b/"+slug+"/recursos/"+recID+"/sesiones?fecha="+fecha+"&hora=10:00", nil)
	req.Header.Set("Authorization", "Bearer "+duenoTok)
	rec := httptest.NewRecorder()
	apiRouter(rec, req)
	var o map[string]interface{}
	_ = json.Unmarshal(rec.Body.Bytes(), &o)
	if rec.Code != http.StatusOK || o["canceladas"].(float64) != 0 {
		t.Fatalf("code=%d out=%v, esperaba 200 con 0", rec.Code, o)
	}
}

// Recurso inexistente → 404.
func TestSesionRecursoInexistente404(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug, duenoTok := setupEspacioTest(t, ctx, "test-ses404", "ses404@test.com")
	fecha, _ := claveManana()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/b/"+slug+"/recursos/nadie/sesiones?fecha="+fecha+"&hora=10:00", nil)
	req.Header.Set("Authorization", "Bearer "+duenoTok)
	rec := httptest.NewRecorder()
	apiRouter(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code=%d, esperaba 404", rec.Code)
	}
}

// Fecha/hora malformadas → 400 con código.
func TestSesionFechaHoraInvalidas400(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug, duenoTok := setupEspacioTest(t, ctx, "test-ses400", "ses400@test.com")
	c, out := postRecursoTest(t, slug, duenoTok,
		`{"name":"Fit","tipo":"clase","capacidad":5,"duration_minutes":60}`)
	if c != http.StatusCreated {
		t.Fatalf("crear code=%d, esperaba 201", c)
	}
	recID, _ := out["id"].(string)
	llamar := func(q string) (int, map[string]interface{}) {
		req := httptest.NewRequest(http.MethodDelete, "/api/v1/b/"+slug+"/recursos/"+recID+"/sesiones?"+q, nil)
		req.Header.Set("Authorization", "Bearer "+duenoTok)
		rec := httptest.NewRecorder()
		apiRouter(rec, req)
		var o map[string]interface{}
		_ = json.Unmarshal(rec.Body.Bytes(), &o)
		return rec.Code, o
	}
	if code, o := llamar("fecha=no-fecha&hora=10:00"); code != http.StatusBadRequest || o["error"] != "fecha_invalida" {
		t.Fatalf("fecha code=%d out=%v, esperaba 400 fecha_invalida", code, o)
	}
	if code, o := llamar("fecha="+mañanaStr()+"&hora=25:99"); code != http.StatusBadRequest || o["error"] != "hora_invalida" {
		t.Fatalf("hora code=%d out=%v, esperaba 400 hora_invalida", code, o)
	}
}

// Cancelar las 10:00 no toca la sesión de las 11:00 del mismo día.
func TestSesionNoTocaOtrosHorarios(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug, duenoTok := setupEspacioTest(t, ctx, "test-sesotras", "sesotras@test.com")
	c, out := postRecursoTest(t, slug, duenoTok,
		`{"name":"Fit","tipo":"clase","capacidad":5,"duration_minutes":60,"instructor_id":"emp1"}`)
	if c != http.StatusCreated {
		t.Fatalf("crear code=%d, esperaba 201", c)
	}
	recID, _ := out["id"].(string)
	fecha, _ := claveManana()
	if bookSesionTest(t, slug, recID, fecha, "10:00", "+573008889999") != http.StatusCreated {
		t.Fatalf("book 10:00 falló")
	}
	if bookSesionTest(t, slug, recID, fecha, "11:00", "+573008880000") != http.StatusCreated {
		t.Fatalf("book 11:00 falló")
	}
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/b/"+slug+"/recursos/"+recID+"/sesiones?fecha="+fecha+"&hora=10:00", nil)
	req.Header.Set("Authorization", "Bearer "+duenoTok)
	rec := httptest.NewRecorder()
	apiRouter(rec, req)
	var o map[string]interface{}
	_ = json.Unmarshal(rec.Body.Bytes(), &o)
	if rec.Code != http.StatusOK || o["canceladas"].(float64) != 1 {
		t.Fatalf("code=%d out=%v, esperaba 200 con 1", rec.Code, o)
	}
	for _, id := range reservaIDsPorTelefono(t, ctx, slug, "+573008880000") {
		doc, _ := firestoreClient.Collection("reservas").Doc(id).Get(ctx)
		if doc.Data()["cancelled"] == true {
			t.Fatalf("la sesión de las 11:00 quedó cancelada por error")
		}
	}
}

// Inscrito con pago revierte el cobrado-real al cancelar la sesión.
func TestSesionReviertePagado(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug, duenoTok := setupEspacioTest(t, ctx, "test-sespago", "sespago@test.com")
	c, out := postRecursoTest(t, slug, duenoTok,
		`{"name":"Fit","tipo":"clase","capacidad":5,"duration_minutes":60,"price":20000,"instructor_id":"emp1"}`)
	if c != http.StatusCreated {
		t.Fatalf("crear code=%d, esperaba 201", c)
	}
	recID, _ := out["id"].(string)
	fecha, _ := claveManana()
	phone := "+573008881234"
	if bookSesionTest(t, slug, recID, fecha, "10:00", phone) != http.StatusCreated {
		t.Fatalf("book sesión falló")
	}
	ids := reservaIDsPorTelefono(t, ctx, slug, phone)
	if len(ids) != 1 {
		t.Fatalf("reservas=%d, esperaba 1", len(ids))
	}
	// Instructor marca pagado por su portal.
	preq := httptest.NewRequest(http.MethodPost,
		"/api/v1/b/"+slug+"/employee/emp1/citas/"+ids[0]+"/pago",
		bytes.NewReader([]byte(`{"pagado":true}`)))
	preq.Header.Set("Content-Type", "application/json")
	preq.Header.Set("Authorization", "Bearer "+signEmployeeToken(slug, "emp1"))
	prec := httptest.NewRecorder()
	apiRouter(prec, preq)
	if prec.Code != http.StatusOK {
		t.Fatalf("pago code=%d body=%s, esperaba 200", prec.Code, prec.Body.String())
	}
	// Dueño cancela la sesión: cobrado vuelve a 0.
	dreq := httptest.NewRequest(http.MethodDelete, "/api/v1/b/"+slug+"/recursos/"+recID+"/sesiones?fecha="+fecha+"&hora=10:00", nil)
	dreq.Header.Set("Authorization", "Bearer "+duenoTok)
	drec := httptest.NewRecorder()
	apiRouter(drec, dreq)
	if drec.Code != http.StatusOK {
		t.Fatalf("sesión code=%d, esperaba 200", drec.Code)
	}
	cli, _ := firestoreClient.Collection("clientes").Doc(clienteDocID(slug, phone)).Get(ctx)
	if p, _ := cli.Data()["paid_total"].(int64); p != 0 {
		t.Fatalf("paid_total=%v, esperaba 0", cli.Data()["paid_total"])
	}
	if v := visitasCliente(t, ctx, slug, phone); v != 0 {
		t.Fatalf("visits=%d, esperaba 0", v)
	}
}

// Espacio flexible: el instructor (que no dicta nada) no puede; el dueño sí.
func TestSesionFlexibleSoloDueno(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug, duenoTok := setupEspacioTest(t, ctx, "test-sesflex", "sesflex@test.com")
	c, out := postRecursoTest(t, slug, duenoTok,
		`{"name":"Cancha","tipo":"cancha","capacidad":4,"duration_minutes":60}`)
	if c != http.StatusCreated {
		t.Fatalf("crear code=%d, esperaba 201", c)
	}
	recID, _ := out["id"].(string)
	fecha, _ := claveManana()
	if bookSesionTest(t, slug, recID, fecha, "10:00", "+573008885678") != http.StatusCreated {
		t.Fatalf("book sesión falló")
	}
	url := "/api/v1/b/" + slug + "/recursos/" + recID + "/sesiones?fecha=" + fecha + "&hora=10:00"
	ireq := httptest.NewRequest(http.MethodDelete, url, nil)
	ireq.Header.Set("Authorization", "Bearer "+signEmployeeToken(slug, "emp1"))
	irec := httptest.NewRecorder()
	apiRouter(irec, ireq)
	if irec.Code != http.StatusUnauthorized {
		t.Fatalf("instructor ajeno code=%d, esperaba 401", irec.Code)
	}
	dreq := httptest.NewRequest(http.MethodDelete, url, nil)
	dreq.Header.Set("Authorization", "Bearer "+duenoTok)
	drec := httptest.NewRecorder()
	apiRouter(drec, dreq)
	var o map[string]interface{}
	_ = json.Unmarshal(drec.Body.Bytes(), &o)
	if drec.Code != http.StatusOK || o["canceladas"].(float64) != 1 {
		t.Fatalf("dueño code=%d out=%v, esperaba 200 con 1", drec.Code, o)
	}
}

// ─── Bloqueo inverso + cupos + reschedule ───

// Llenar la capacidad: el siguiente cupo se rechaza (sold out).
func TestCupoLlenoSoldOut(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug, duenoTok := setupEspacioTest(t, ctx, "test-soldout2", "soldout2@test.com")
	c, out := postRecursoTest(t, slug, duenoTok,
		`{"name":"Fit","tipo":"clase","capacidad":2,"duration_minutes":60,"instructor_id":"emp1"}`)
	if c != http.StatusCreated {
		t.Fatalf("crear code=%d, esperaba 201", c)
	}
	recID, _ := out["id"].(string)
	fecha, _ := claveManana()
	if bookSesionTest(t, slug, recID, fecha, "10:00", "+573008890001") != http.StatusCreated {
		t.Fatalf("cupo 1 falló")
	}
	if bookSesionTest(t, slug, recID, fecha, "10:00", "+573008890002") != http.StatusCreated {
		t.Fatalf("cupo 2 falló")
	}
	body, _ := json.Marshal(map[string]interface{}{
		"recursoId": recID,
		"fecha": fecha, "hora": "10:00",
		"clienteNombre": "Lleno", "clienteTelefono": "+573008890003",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	authClienteUnico(t, req)
	rec := httptest.NewRecorder()
	bookHandler(rec, req, slug)
	var o map[string]interface{}
	_ = json.Unmarshal(rec.Body.Bytes(), &o)
	if rec.Code != http.StatusConflict || o["error"] != "sin_cupo" {
		t.Fatalf("code=%d out=%v, esperaba 409 sin_cupo", rec.Code, o)
	}
}

// ─── Dos espacios, misma hora, mismo instructor ───

// Dos clases a la misma hora con el mismo instructor se rechazan en la
// creación (un instructor no dicta dos clases a la vez).
func TestDosEspaciosMismoInstructorSeBloqueaEnCreacion(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug, duenoTok := setupEspacioTest(t, ctx, "test-dosesp", "dosesp@test.com")
	_, clave := claveManana()
	mk := func(nombre, dia, ini, fin string) (int, map[string]interface{}) {
		return postRecursoTest(t, slug, duenoTok,
			fmt.Sprintf(`{"name":%q,"tipo":"clase","capacidad":10,"duration_minutes":60,"instructor_id":"emp1","horario":%s}`, nombre, horarioDiaJSON(dia, ini, fin)))
	}
	if c, _ := mk("Fit A", clave, "09:00", "18:00"); c != http.StatusCreated {
		t.Fatalf("clase A code=%d, esperaba 201", c)
	}
	c2, out2 := mk("Fit B", clave, "10:00", "12:00")
	if c2 != http.StatusConflict || out2["error"] != "instructor_con_choque" {
		t.Fatalf("clase B code=%d out=%v, esperaba 409 instructor_con_choque", c2, out2)
	}
	// Seguidas (09-10 y 10-11) sí se permiten: fin==inicio no es solape.
	if c3, _ := mk("Fit C", clave, "18:00", "19:00"); c3 != http.StatusCreated {
		t.Fatalf("clase C seguida code=%d, esperaba 201", c3)
	}
}

// Reservar en la sesión A hace desaparecer el mismo horario en B; reservar
// en B da 409; al cancelar A, B reaparece.
func TestDosEspaciosMismoInstructorBloqueoCruzado(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug, duenoTok := setupEspacioTest(t, ctx, "test-dosbloq", "dosbloq@test.com")
	fecha, clave := claveManana()
	mk := func(nombre string) string {
		c, out := postRecursoTest(t, slug, duenoTok,
			fmt.Sprintf(`{"name":%q,"tipo":"clase","capacidad":10,"duration_minutes":60,"instructor_id":"emp1","horario":%s}`, nombre, horarioDiaJSON(clave, "09:00", "18:00")))
		if c != http.StatusCreated {
			t.Fatalf("crear %s code=%d, esperaba 201", nombre, c)
		}
		id, _ := out["id"].(string)
		return id
	}
	recA := mk("Fit A")
	// Fit B se inserta directo (el Escudo ya impediría duplicarla por API):
	// simula datos legacy para probar el bloqueo cruzado en reservas.
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Collection("recursos").Doc("recB").Set(ctx, map[string]interface{}{
		"name": "Fit B", "tipo": "clase", "capacidad": 10,
		"duration_minutes": 60, "price": "0", "instructor_id": "emp1",
		"horario": map[string]interface{}{
			clave: map[string]interface{}{"activo": true, "turnos": []interface{}{
				map[string]interface{}{"inicio": "09:00", "fin": "18:00"},
			}},
		},
	}); err != nil {
		t.Fatal(err)
	}
	recB := "recB"
	// Ambas ofrecen las 10:00 sin alumnos.
	if s := slotsListaTest(t, slug, "recurso_id="+recA+"&fecha="+fecha+"&cupos=1"); !contieneHora(s, "10:00") {
		t.Fatalf("A sin 10:00: %v", s)
	}
	if s := slotsListaTest(t, slug, "recurso_id="+recB+"&fecha="+fecha+"&cupos=1"); !contieneHora(s, "10:00") {
		t.Fatalf("B sin 10:00: %v", s)
	}
	// Reserva en A a las 10:00.
	code, out := postBook(t, slug, map[string]string{
		"recursoId": recA,
		"fecha": fecha, "hora": "10:00",
		"clienteNombre": "X", "clienteTelefono": "+573008893333",
	})
	if code != http.StatusCreated {
		t.Fatalf("book A code=%d out=%v, esperaba 201", code, out)
	}
	// B ya no ofrece las 10:00 (instructora ocupada en A).
	if s := slotsListaTest(t, slug, "recurso_id="+recB+"&fecha="+fecha+"&cupos=1"); contieneHora(s, "10:00") {
		t.Fatalf("B ofrece 10:00 con instructora en A: %v", s)
	}
	// Reserva directa en B → 409 (hora fuera de rejilla por instructor).
	body, _ := json.Marshal(map[string]interface{}{
		"recursoId": recB,
		"fecha": fecha, "hora": "10:00",
		"clienteNombre": "Y", "clienteTelefono": "+573008894444",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	authClienteUnico(t, req)
	rec := httptest.NewRecorder()
	bookHandler(rec, req, slug)
	var o map[string]interface{}
	_ = json.Unmarshal(rec.Body.Bytes(), &o)
	if rec.Code != http.StatusConflict || o["error"] != "slot_taken" {
		t.Fatalf("book B code=%d out=%v, esperaba 409 slot_taken", rec.Code, o)
	}
	// Dueño cancela la de A → las 10:00 de B reaparecen.
	citaID, _ := out["cita_id"].(string)
	creq := httptest.NewRequest(http.MethodDelete, "/api/v1/b/"+slug+"/citas/"+citaID, nil)
	creq.Header.Set("Authorization", "Bearer "+duenoTok)
	crec := httptest.NewRecorder()
	apiRouter(crec, creq)
	if crec.Code != http.StatusOK {
		t.Fatalf("cancel A code=%d, esperaba 200", crec.Code)
	}
	if s := slotsListaTest(t, slug, "recurso_id="+recB+"&fecha="+fecha+"&cupos=1"); !contieneHora(s, "10:00") {
		t.Fatalf("B sin 10:00 tras cancelar A: %v", s)
	}
}

// Mismo horario con distinto instructor: totalmente independientes.
func TestDosEspaciosDistintoInstructorIndependientes(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug, duenoTok := setupEspacioTest(t, ctx, "test-dosind", "dosind@test.com")
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Collection("empleados").Doc("emp2").Set(ctx, map[string]interface{}{
		"name": "Luis",
	}); err != nil {
		t.Fatal(err)
	}
	fecha, clave := claveManana()
	mk := func(nombre, emp string) string {
		c, out := postRecursoTest(t, slug, duenoTok,
			fmt.Sprintf(`{"name":%q,"tipo":"clase","capacidad":10,"duration_minutes":60,"instructor_id":%q,"horario":%s}`, nombre, emp, horarioDiaJSON(clave, "09:00", "18:00")))
		if c != http.StatusCreated {
			t.Fatalf("crear %s code=%d, esperaba 201", nombre, c)
		}
		id, _ := out["id"].(string)
		return id
	}
	recA, recC := mk("Fit Ana", "emp1"), mk("Fit Luis", "emp2")
	code, _ := postBook(t, slug, map[string]string{
		"recursoId": recA,
		"fecha": fecha, "hora": "10:00",
		"clienteNombre": "X", "clienteTelefono": "+573008895555",
	})
	if code != http.StatusCreated {
		t.Fatalf("book A code=%d, esperaba 201", code)
	}
	if s := slotsListaTest(t, slug, "recurso_id="+recC+"&fecha="+fecha+"&cupos=1"); !contieneHora(s, "10:00") {
		t.Fatalf("C bloqueada por clase ajena: %v", s)
	}
	code2, _ := postBook(t, slug, map[string]string{
		"recursoId": recC,
		"fecha": fecha, "hora": "10:00",
		"clienteNombre": "Y", "clienteTelefono": "+573008896666",
	})
	if code2 != http.StatusCreated {
		t.Fatalf("book C code=%d, esperaba 201", code2)
	}
}

// Mover un 1-a-1 a la hora de una clase con alumnos → 409.
func TestRescheduleAClase409(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug, duenoTok := setupEspacioTest(t, ctx, "test-resclase", "resclase@test.com")
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Collection("recursos").Doc("rec1").Set(ctx, map[string]interface{}{
		"name": "Fit", "tipo": "clase", "capacidad": 10,
		"duration_minutes": 60, "price": "0", "instructor_id": "emp1",
	}); err != nil {
		t.Fatal(err)
	}
	fecha, _ := claveManana()
	// 1-a-1 a las 09:00.
	code, _ := postBook(t, slug, map[string]string{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": fecha, "hora": "09:00",
		"clienteNombre": "X", "clienteTelefono": "+573008891111",
	})
	if code != http.StatusCreated {
		t.Fatalf("book 1-a-1 code=%d, esperaba 201", code)
	}
	// Clase con alumno a las 10:00 (60 min).
	if bookSesionTest(t, slug, "rec1", fecha, "10:00", "+573008892222") != http.StatusCreated {
		t.Fatalf("book sesión falló")
	}
	// Mover el 1-a-1 a las 10:00 (choca con la sesión) → 409.
	ids := reservaIDsPorTelefono(t, ctx, slug, "+573008891111")
	mr := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/citas/"+ids[0]+"/reschedule",
		bytes.NewReader([]byte(`{"fecha":"`+fecha+`","hora":"10:00"}`)))
	mr.Header.Set("Content-Type", "application/json")
	mr.Header.Set("Authorization", "Bearer "+duenoTok)
	mrec := httptest.NewRecorder()
	rescheduleCitaHandler(mrec, mr, slug, ids[0])
	if mrec.Code != http.StatusConflict {
		t.Fatalf("mover code=%d body=%s, esperaba 409", mrec.Code, mrec.Body.String())
	}
}
