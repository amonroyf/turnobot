package main

import (
	"context"
	"net/http"
	"testing"
	"time"
)

// Espejo barberia-vip: sin open/close, emp sin horario ni calendar, svc 30min.
func TestReproLun1600(t *testing.T) {
	testFirestoreClient(t)
	testAuthClient(t)
	ctx := context.Background()
	slug := slugUnico("test-repro1600")
	c := firestoreClient
	_, err := c.Collection("negocios").Doc(slug).Set(ctx, map[string]interface{}{
		"name": "Mirror", "owner_uid": "owner-test", "timezone": "America/Bogota",
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
	// Próximo lunes estrictamente futuro en Bogotá: la fecha quemada
	// original (2026-09-28 16:00) se pudría en cuanto pasaba esa hora y el
	// test fallaba con 400 aunque el código estuviera bien.
	bog, _ := time.LoadLocation("America/Bogota")
	ahora := time.Now().In(bog)
	delta := (int(time.Monday) - int(ahora.Weekday()) + 7) % 7
	if delta == 0 {
		delta = 7
	}
	fechaLunes := ahora.AddDate(0, 0, delta).Format("2006-01-02")
	code, out := postBook(t, slug, map[string]string{
		"servicioId": "svc1", "empleadoId": "emp1",
		"fecha": fechaLunes, "hora": "16:00",
		"clienteNombre": "X", "clienteTelefono": "+573009988877",
	})
	if code != http.StatusCreated {
		t.Fatalf("code=%d out=%v, esperaba 201", code, out)
	}
}
