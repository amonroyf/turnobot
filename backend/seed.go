//go:build ignore

package main

import (
	"context"
	"log"
	"os"

	"cloud.google.com/go/firestore"
)

func main() {
	ctx := context.Background()
	projectID := "stalwart-coast-439901-d0"

	// Guardia: este script hace Set SIN merge (sobrescribe el negocio).
	// Nunca correr contra producción sin confirmación explícita.
	if os.Getenv("SEED_ALLOW_PROD") != "1" {
		log.Fatal("Rehusado: seed apunta a producción. Define SEED_ALLOW_PROD=1 solo si sabes lo que haces (sobrescribe negocios/barberia-vip).")
	}

	client, err := firestore.NewClient(ctx, projectID)
	if err != nil {
		log.Fatalf("Error creando cliente Firestore: %v", err)
	}
	defer client.Close()

	log.Println("Conectando a Firestore e insertando datos de prueba...")

	// El slug del negocio es el que el frontend usa en la URL /api/v1/b/{slug}
	negocioID := "barberia-vip"

	// 1. Crear el documento del Negocio
	_, err = client.Collection("negocios").Doc(negocioID).Set(ctx, map[string]interface{}{
		"name":        "Barbería VIP",
		"calendar_id": "primary",
		"whatsapp":    "573001234567",
		"direccion":   "Calle 123 # 45-67, Bogotá",
		"horario":     "Lun - Sáb: 9:00 AM a 7:00 PM",
		"telefono":    "3001234567",
		"timezone":    "America/Bogota",
	})
	if err != nil {
		log.Fatalf("Error creando negocio: %v", err)
	}

	// 2. Crear los Servicios (como subcolección del negocio)
	servicios := []struct {
		id       string
		name     string
		duration int
		price    string
	}{
		{"svc_corte", "Corte de Cabello", 30, "30000"},
		{"svc_barba", "Arreglo de Barba", 20, "20000"},
		{"svc_combo", "Corte + Barba", 50, "45000"},
	}

	for _, s := range servicios {
		_, err = client.Collection("negocios").Doc(negocioID).Collection("servicios").Doc(s.id).Set(ctx, map[string]interface{}{
			"name":             s.name,
			"duration_minutes": s.duration,
			"price":            s.price,
		})
		if err != nil {
			log.Fatalf("Error creando servicio %s: %v", s.name, err)
		}
	}

	// 3. Crear los Empleados (como subcolección del negocio)
	empleados := []struct {
		id   string
		name string
	}{
		{"emp_alejandro", "Alejandro"},
		{"emp_carlos", "Carlos"},
	}

	for _, e := range empleados {
		_, err = client.Collection("negocios").Doc(negocioID).Collection("empleados").Doc(e.id).Set(ctx, map[string]interface{}{
			"name":        e.name,
			"calendar_id": "primary",
		})
		if err != nil {
			log.Fatalf("Error creando empleado %s: %v", e.name, err)
		}
	}

	log.Println("¡Base de datos Firestore poblada con éxito!")
}
