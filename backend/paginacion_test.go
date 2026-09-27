package main

// Paginación de listas: cursores inclusivos + dedupe por id en cliente.
// Cubre GET /citas (MisCitas) y GET employee/{id}/citas (portal).
import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// postBookComo reserva como un cliente explícito (mismo UID en varias).
func postBookComo(t *testing.T, slug, email string, payload map[string]interface{}) (int, map[string]interface{}) {
	t.Helper()
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/b/"+slug+"/book", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+tokenClienteTest(t, email))
	rec := httptest.NewRecorder()
	bookHandler(rec, req, slug)
	var out map[string]interface{}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

// getCitasCliente llama GET /citas con el token del cliente.
func getCitasCliente(t *testing.T, slug, email, qs string) (int, []byte) {
	t.Helper()
	url := "/api/v1/b/" + slug + "/citas"
	if qs != "" {
		url += "?" + qs
	}
	req := httptest.NewRequest(http.MethodGet, url, nil)
	req.Header.Set("Authorization", "Bearer "+tokenClienteTest(t, email))
	rec := httptest.NewRecorder()
	apiRouter(rec, req)
	return rec.Code, rec.Body.Bytes()
}

// paginaCli es una página de citas con cursor compuesto.
type paginaCli struct {
	Citas      []map[string]interface{} `json:"citas"`
	NextCursor *struct {
		Iso string `json:"iso"`
		ID  string `json:"id"`
	} `json:"next_cursor"`
}

// MisCitas: legado array sin params; objeto con limit; cursor recorre todo
// sin saltar ni duplicar (3 citas, páginas de 2).
func TestMisCitasPaginacion(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-pagcli")
	seedTienda(t, ctx, slug)
	email := "pagcli@test.com"
	fecha := mañanaStr()
	telefonos := []string{"+573009900011", "+573009900022", "+573009900033"}
	for i, h := range []string{"09:00", "10:00", "11:00"} {
		code, _ := postBookComo(t, slug, email, map[string]interface{}{
			"servicioId": "svc1", "empleadoId": "emp1",
			"fecha": fecha, "hora": h,
			"clienteNombre": "P", "clienteTelefono": telefonos[i],
		})
		if code != http.StatusCreated {
			t.Fatalf("book %s code=%d, esperaba 201", h, code)
		}
	}
	// Legado: array completo.
	code, body := getCitasCliente(t, slug, email, "")
	if code != http.StatusOK {
		t.Fatalf("legado code=%d, esperaba 200", code)
	}
	var arr []map[string]interface{}
	if err := json.Unmarshal(body, &arr); err != nil || len(arr) != 3 {
		t.Fatalf("legado=%s, esperaba array de 3", body)
	}
	// Página 1: 2 + cursor compuesto.
	code, body = getCitasCliente(t, slug, email, "limit=2")
	if code != http.StatusOK {
		t.Fatalf("p1 code=%d, esperaba 200", code)
	}
	var p1 paginaCli
	if err := json.Unmarshal(body, &p1); err != nil || len(p1.Citas) != 2 || p1.NextCursor == nil {
		t.Fatalf("p1=%s, esperaba 2 + cursor", body)
	}
	// Página 2: 1 + fin.
	code, body = getCitasCliente(t, slug, email, "limit=2&cursor="+p1.NextCursor.Iso+"&cursor_id="+p1.NextCursor.ID)
	if code != http.StatusOK {
		t.Fatalf("p2 code=%d, esperaba 200", code)
	}
	var p2 paginaCli
	if err := json.Unmarshal(body, &p2); err != nil || len(p2.Citas) != 1 || p2.NextCursor != nil {
		t.Fatalf("p2=%s, esperaba 1 sin cursor", body)
	}
	// Unión sin duplicados ni faltantes.
	vistos := map[string]bool{}
	for _, c := range append(p1.Citas, p2.Citas...) {
		id, _ := c["id"].(string)
		if vistos[id] {
			t.Fatalf("id duplicado %s entre páginas", id)
		}
		vistos[id] = true
	}
	if len(vistos) != 3 {
		t.Fatalf("unión=%d, esperaba 3", len(vistos))
	}
	// Cursor malo → 400.
	if code, _ := getCitasCliente(t, slug, email, "limit=2&cursor=malo"); code != http.StatusBadRequest {
		t.Fatalf("cursor malo code=%d, esperaba 400", code)
	}
}

// Mismo minuto (familia/grupo): dos citas a las 10:00 del mismo cliente se
// recorren sin saltar ni repetir con cursor compuesto.
func TestMisCitasMismoMinuto(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-pagmin")
	seedTienda(t, ctx, slug)
	// Espacio SIN instructor: no hay bloqueo cruzado con el 1-a-1.
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Collection("recursos").Doc("rec1").Set(ctx, map[string]interface{}{
		"name": "Cancha", "tipo": "cancha", "capacidad": 4,
		"duration_minutes": 60, "price": "0",
	}); err != nil {
		t.Fatal(err)
	}
	email := "pagmin@test.com"
	fecha := mañanaStr()
	code, _ := postBookComo(t, slug, email, map[string]interface{}{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": fecha, "hora": "10:00",
		"clienteNombre": "P", "clienteTelefono": "+573009933311",
	})
	if code != http.StatusCreated {
		t.Fatalf("book 1-a-1 code=%d, esperaba 201", code)
	}
	code, _ = postBookComo(t, slug, email, map[string]interface{}{
		"recursoId": "rec1",
		"fecha": fecha, "hora": "10:00",
		"clienteNombre": "P", "clienteTelefono": "+573009933322",
	})
	if code != http.StatusCreated {
		t.Fatalf("book espacio code=%d, esperaba 201", code)
	}
	code, body := getCitasCliente(t, slug, email, "limit=1")
	if code != http.StatusOK {
		t.Fatalf("p1 code=%d, esperaba 200", code)
	}
	var p1 paginaCli
	if err := json.Unmarshal(body, &p1); err != nil || len(p1.Citas) != 1 || p1.NextCursor == nil {
		t.Fatalf("p1=%s, esperaba 1 + cursor", body)
	}
	code, body = getCitasCliente(t, slug, email, "limit=1&cursor="+p1.NextCursor.Iso+"&cursor_id="+p1.NextCursor.ID)
	if code != http.StatusOK {
		t.Fatalf("p2 code=%d, esperaba 200", code)
	}
	var p2 paginaCli
	if err := json.Unmarshal(body, &p2); err != nil || len(p2.Citas) != 1 || p2.NextCursor != nil {
		t.Fatalf("p2=%s, esperaba 1 sin cursor", body)
	}
	id1, _ := p1.Citas[0]["id"].(string)
	id2, _ := p2.Citas[0]["id"].(string)
	if id1 == "" || id2 == "" || id1 == id2 {
		t.Fatalf("ids %q %q, esperaba 2 distintas", id1, id2)
	}
}

// Motivo fuera_de_horario: domingo cerrado para emp1 → 409 con diagnóstico.
func TestSlotMotivoFueraDeHorario(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-motivo")
	seedTienda(t, ctx, slug)
	// emp1 trabaja Lun–Sáb; domingo cerrado.
	dias := map[string]interface{}{}
	for _, d := range []string{"lunes", "martes", "miercoles", "jueves", "viernes", "sabado"} {
		dias[d] = map[string]interface{}{"activo": true, "turnos": []interface{}{
			map[string]interface{}{"inicio": "09:00", "fin": "18:00"},
		}}
	}
	dias["domingo"] = map[string]interface{}{"activo": false, "turnos": []interface{}{}}
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Collection("empleados").Doc("emp1").Set(ctx, map[string]interface{}{
		"name": "Ana", "horario": dias,
	}); err != nil {
		t.Fatal(err)
	}
	domingo := fechaProximoDia(time.Sunday)
	code, out := postBookComo(t, slug, "motivo@test.com", map[string]interface{}{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": domingo, "hora": "10:00",
		"clienteNombre": "X", "clienteTelefono": "+573009944411",
	})
	if code != http.StatusConflict || out["error"] != "slot_taken" || out["motivo"] != "fuera_de_horario" {
		t.Fatalf("code=%d out=%v, esperaba 409 slot_taken fuera_de_horario", code, out)
	}
}

// Portal empleado: mezcla directas + clases que dicta, paginada y completa.
func TestEmpleadoCitasPaginacion(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-pagemp")
	seedTienda(t, ctx, slug)
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Collection("recursos").Doc("rec1").Set(ctx, map[string]interface{}{
		"name": "Fit", "tipo": "clase", "capacidad": 10,
		"duration_minutes": 60, "price": "0", "instructor_id": "emp1",
	}); err != nil {
		t.Fatal(err)
	}
	fecha := mañanaStr()
	email := "pagemp@test.com"
	code, _ := postBookComo(t, slug, email, map[string]interface{}{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": fecha, "hora": "09:00",
		"clienteNombre": "X", "clienteTelefono": "+573009911111",
	})
	if code != http.StatusCreated {
		t.Fatalf("book 1-a-1 code=%d, esperaba 201", code)
	}
	code, _ = postBookComo(t, slug, email, map[string]interface{}{
		"recursoId": "rec1",
		"fecha": fecha, "hora": "10:00",
		"clienteNombre": "Y", "clienteTelefono": "+573009922222",
	})
	if code != http.StatusCreated {
		t.Fatalf("book sesión code=%d, esperaba 201", code)
	}
	llamar := func(qs string) (int, []byte) {
		url := "/api/v1/b/" + slug + "/employee/emp1/citas"
		if qs != "" {
			url += "?" + qs
		}
		req := httptest.NewRequest(http.MethodGet, url, nil)
		req.Header.Set("Authorization", "Bearer "+signEmployeeToken(slug, "emp1"))
		rec := httptest.NewRecorder()
		apiRouter(rec, req)
		return rec.Code, rec.Body.Bytes()
	}
	// Legado: array de 2.
	if code, body := llamar(""); code != http.StatusOK {
		t.Fatalf("legado code=%d, esperaba 200", code)
	} else {
		var arr []map[string]interface{}
		if err := json.Unmarshal(body, &arr); err != nil || len(arr) != 2 {
			t.Fatalf("legado=%s, esperaba array de 2", body)
		}
	}
	// Página 1 de 1 + cursor; página 2 con la otra fuente.
	code, body := llamar("limit=1")
	if code != http.StatusOK {
		t.Fatalf("p1 code=%d, esperaba 200", code)
	}
	var p1 paginaCli
	if err := json.Unmarshal(body, &p1); err != nil || len(p1.Citas) != 1 || p1.NextCursor == nil {
		t.Fatalf("p1=%s, esperaba 1 + cursor", body)
	}
	code, body = llamar("limit=1&cursor=" + p1.NextCursor.Iso + "&cursor_id=" + p1.NextCursor.ID)
	if code != http.StatusOK {
		t.Fatalf("p2 code=%d, esperaba 200", code)
	}
	var p2 paginaCli
	if err := json.Unmarshal(body, &p2); err != nil || len(p2.Citas) != 1 || p2.NextCursor != nil {
		t.Fatalf("p2=%s, esperaba 1 sin cursor", body)
	}
	id1, _ := p1.Citas[0]["id"].(string)
	id2, _ := p2.Citas[0]["id"].(string)
	if id1 == "" || id2 == "" || id1 == id2 {
		t.Fatalf("páginas id1=%q id2=%q, esperaba 2 distintas", id1, id2)
	}
}
