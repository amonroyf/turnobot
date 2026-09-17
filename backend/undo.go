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

// undoCitaHandler deshace una cancelación o no-show de una cita.
// POST /api/v1/b/{slug}/citas/{citaID}/undo
// Solo permite deshacer si la cita fue cancelada/marcada hoy (mismo día
// en la zona horaria del negocio). No restaura el evento de Google Calendar.
// Puede ser invocado por: el dueño o el empleado asignado.
func undoCitaHandler(w http.ResponseWriter, r *http.Request, slug, citaID string) {
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
		http.Error(w, "Cita no encontrada", http.StatusNotFound)
		return
	}

	// AUTORIZACIÓN: dueño o empleado asignado.
	isOwner := isOwnerRequest(r, slug)
	isEmployee := !isOwner && isAssignedEmployeeRequest(r, slug, b.EmpID)
	if !isOwner && !isEmployee {
		http.Error(w, "No autorizado", http.StatusUnauthorized)
		return
	}

	wasCancelled := doc.Data()["cancelled"] == true
	wasNoShow := b.NoShow

	if !wasCancelled && !wasNoShow {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "not_cancelled_or_noshow",
			"message": "La cita no está cancelada ni marcada como no-show.",
		})
		return
	}

	// RESTRICCIÓN DE TIEMPO: solo mismo día (zona horaria del negocio).
	loc := shopLocation(ctx, slug)
	hoy := time.Now().In(loc).Format("2006-01-02")
	fechaCita := b.DateTime.In(loc).Format("2006-01-02")
	if fechaCita != hoy {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "outside_same_day",
			"message": "Solo se puede deshacer una acción del mismo día.",
		})
		return
	}

	// Determinar qué campos revertir
	updates := []firestore.Update{
		{Path: "updated_at", Value: time.Now()},
	}
	var pushTitle, pushBody string

	if wasCancelled {
		updates = append(updates, firestore.Update{Path: "cancelled", Value: false})
		updates = append(updates, firestore.Update{Path: "cancelled_at", Value: nil})
		pushTitle = "✅ Cita restaurada"
		pushBody = fmt.Sprintf("Tu cita de %s fue restaurada. Sigue activa.", b.ServiceName)
		// Revertir CRM: sumar de vuelta
		incrementCliente(ctx, slug, b.UserPhone, b.Price)
		updateNegocioStats(ctx, slug, 1, b.Price)
	} else if wasNoShow {
		updates = append(updates, firestore.Update{Path: "no_show", Value: false})
		pushTitle = "✅ Cita restaurada"
		pushBody = fmt.Sprintf("Tu cita de %s fue restaurada. Ya no está marcada como no-show.", b.ServiceName)
		// Revertir CRM: sumar de vuelta
		incrementCliente(ctx, slug, b.UserPhone, b.Price)
		updateNegocioStats(ctx, slug, 1, b.Price)
	}

	_, err = docRef.Update(ctx, updates)
	if err != nil {
		log.Printf("Error deshaciendo cita %s: %v", citaID, err)
		http.Error(w, "Error deshaciendo la acción", http.StatusInternalServerError)
		return
	}

	// Push al cliente: notificar que la cita fue restaurada
	if b.ClientPushToken != "" {
		go sendPushToClient(context.Background(), b.ClientPushToken,
			pushTitle, pushBody,
			"/shop/"+slug, "undo-"+citaID)
	}

	action := "cancelación"
	if wasNoShow {
		action = "no-show"
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"message":    fmt.Sprintf("Se deshizo la %s exitosamente", action),
		"cita_id":    citaID,
		"action":     action,
		"date_time":  b.DateTime.Format(time.RFC3339),
	})
}

// incrementCliente suma de vuelta una visita y el gasto del servicio al
// directorio de clientes (usado al deshacer cancelación/no-show).
func incrementCliente(ctx context.Context, slug, phone string, price int) {
	if slug == "" || phone == "" {
		return
	}
	ref := firestoreClient.Collection("clientes").Doc(clienteDocID(slug, phone))
	_, err := ref.Set(ctx, map[string]interface{}{
		"negocio_id":    slug,
		"cliente_phone": phone,
		"visits":        firestore.Increment(1),
		"total_spent":   firestore.Increment(price),
		"updated_at":    time.Now(),
	}, firestore.MergeAll)
	if err != nil {
		log.Printf("Aviso: no se pudo restaurar al cliente %s en %s: %v", phone, slug, err)
	}
}
