package main

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"cloud.google.com/go/firestore"
)

// markNoShowHandler marca una cita como no-show manualmente.
// POST /api/v1/b/{slug}/no-show/{citaID}
func markNoShowHandler(w http.ResponseWriter, r *http.Request, slug, citaID string) {
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
		http.Error(w, "Cita no pertenece a este negocio", http.StatusForbidden)
		return
	}

	_, err = docRef.Update(ctx, []firestore.Update{
		{Path: "no_show", Value: true},
		{Path: "updated_at", Value: time.Now()},
	})
	if err != nil {
		log.Printf("Error marcando no-show: %v", err)
		http.Error(w, "Error marcando no-show", http.StatusInternalServerError)
		return
	}

	// CRM: restar visita y gasto del cliente por no-show
	decrementCliente(ctx, slug, b.UserPhone, b.Price)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Cita marcada como no-show",
		"cita_id": citaID,
	})
}
