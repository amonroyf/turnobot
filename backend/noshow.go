package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"cloud.google.com/go/firestore"
)

// canMarkNoShow indica si una cita puede marcarse como no-show: solo citas
// que ya ocurrieron (o están en curso). Las futuras se rechazan.
func canMarkNoShow(dateTime, now time.Time) bool {
	return !dateTime.After(now)
}

// markNoShowHandler marca una cita como no-show manualmente.
// POST /api/v1/b/{slug}/no-show/{citaID}
// Puede ser invocado por: el dueño o el empleado asignado. Idempotente:
// repetir la llamada no duplica el ajuste del CRM.
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

	// AUTORIZACIÓN: dueño o empleado asignado.
	isOwner := isOwnerRequest(r, slug)
	isEmployee := !isOwner && isAssignedEmployeeRequest(r, slug, b.EmpID)
	if !isOwner && !isEmployee {
		http.Error(w, "No autorizado", http.StatusUnauthorized)
		return
	}

	// Solo citas pasadas: no tiene sentido un no-show a futuro.
	if !canMarkNoShow(b.DateTime, time.Now()) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "no_show_futuro",
			"message": "Solo se puede marcar no-show en citas que ya pasaron.",
		})
		return
	}

	// Idempotencia: si ya era no-show, éxito sin volver a tocar el CRM.
	if b.NoShow {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "La cita ya estaba marcada como no-show",
			"cita_id": citaID,
		})
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
	// SaaS: restar métricas maestras del negocio
	updateNegocioStats(ctx, slug, -1, b.Price)

	// Push al cliente: notificar que su cita fue marcada como no-show
	if b.ClientPushToken != "" {
		loc := shopLocation(ctx, slug)
		fechaStr := b.DateTime.In(loc).Format("02/01")
		horaStr := b.DateTime.In(loc).Format("15:04")
		go sendPushToClient(context.Background(), b.ClientPushToken,
			"⚠️ Cita marcada como no-show",
			fmt.Sprintf("Tu cita de %s (%s a las %s) fue marcada como no-show.", b.ServiceName, fechaStr, horaStr),
			"/shop/"+slug, "noshow-"+citaID)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Cita marcada como no-show",
		"cita_id": citaID,
	})
}
