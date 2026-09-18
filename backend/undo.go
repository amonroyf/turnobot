package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"cloud.google.com/go/firestore"
)

// undoCitaHandler deshace una cancelación o no-show de una cita.
// POST /api/v1/b/{slug}/citas/{citaID}/undo
// Ventana: la cita es de hoy (zona del negocio) O la acción se hizo hace
// menos de 24h (así se puede corregir al día siguiente un no-show marcado
// tarde; antes era imposible porque la cita pasada nunca es "hoy").
// Si se deshace una cancelación, se recrea el evento de Google Calendar
// (cancelar lo había borrado).
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

	// VENTANA: cita de hoy (zona del negocio) O acción reciente (<24h).
	// El no-show se marca sobre citas ya pasadas, así que exigir "cita de hoy"
	// impedía corregirlo al día siguiente. Guardamos cancelled_at/no_show_at
	// al marcar para medir la ventana desde la acción, no desde la cita.
	loc := shopLocation(ctx, slug)
	hoy := time.Now().In(loc).Format("2006-01-02")
	fechaCita := b.DateTime.In(loc).Format("2006-01-02")
	accionReciente := false
	if wasCancelled {
		accionReciente = marcaReciente(doc.Data()["cancelled_at"], 24*time.Hour)
	} else {
		accionReciente = marcaReciente(doc.Data()["no_show_at"], 24*time.Hour)
	}
	if fechaCita != hoy && !accionReciente {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "outside_window",
			"message": "Solo se puede deshacer el mismo día o dentro de las 24 horas de la acción.",
		})
		return
	}

	// Transacción atómica: reversión + CRM se aplican juntos o nada.
	// Re-verifica dentro del tx (carrera: otro undo concurrente).
	// Además resetea reminder_sent: una cita restaurada aún futura debe
	// volver al radar del cron (antes quedaba sin recordatorio).
	var pushTitle, pushBody string
	err = firestoreClient.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		snap, err := tx.Get(docRef)
		if err != nil {
			return err
		}
		stillCancelled := snap.Data()["cancelled"] == true
		var cur Booking
		snap.DataTo(&cur)
		if !stillCancelled && !cur.NoShow {
			return errYaAplicado
		}
		updates := []firestore.Update{
			{Path: "updated_at", Value: time.Now()},
			{Path: "reminder_sent", Value: false},
		}
		if stillCancelled {
			updates = append(updates, firestore.Update{Path: "cancelled", Value: false})
			updates = append(updates, firestore.Update{Path: "cancelled_at", Value: firestore.Delete})
		} else {
			updates = append(updates, firestore.Update{Path: "no_show", Value: false})
			updates = append(updates, firestore.Update{Path: "no_show_at", Value: firestore.Delete})
		}
		if err := tx.Update(docRef, updates); err != nil {
			return err
		}
		cliRef := firestoreClient.Collection("clientes").Doc(clienteDocID(slug, b.UserPhone))
		if err := tx.Set(cliRef, clienteCRMData(slug, b.UserPhone, 1, b.Price), firestore.MergeAll); err != nil {
			return err
		}
		if !stillCancelled {
			// Revertir el contador de no-shows del cliente.
			if err := tx.Set(cliRef, map[string]interface{}{
				"no_shows": firestore.Increment(-1),
			}, firestore.MergeAll); err != nil {
				return err
			}
		}
		negRef := firestoreClient.Collection("negocios").Doc(slug)
		return tx.Set(negRef, negocioStatsData(1, b.Price), firestore.MergeAll)
	})
	if err != nil {
		if errors.Is(err, errYaAplicado) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": true,
				"message": "La cita ya estaba activa",
				"cita_id": citaID,
			})
			return
		}
		log.Printf("Error deshaciendo cita %s: %v", citaID, err)
		http.Error(w, "Error deshaciendo la acción", http.StatusInternalServerError)
		return
	}

	if wasCancelled {
		pushTitle = "✅ Cita restaurada"
		pushBody = fmt.Sprintf("Tu cita de %s fue restaurada. Sigue activa.", b.ServiceName)
	} else {
		pushTitle = "✅ Cita restaurada"
		pushBody = fmt.Sprintf("Tu cita de %s fue restaurada. Ya no está marcada como no-show.", b.ServiceName)
	}

	// Restaurar el evento de Google Calendar: cancelar lo borró del
	// calendario del profesional (el campo calendar_event_id quedó huérfano).
	// El no-show nunca borra, así que solo se recrea al deshacer cancelación.
	// Best-effort: si falla, la cita queda activa igual y se registra el aviso.
	if wasCancelled {
		go func() {
			bgCtx := context.Background()
			direccion := ""
			if negDoc, err := firestoreClient.Collection("negocios").Doc(slug).Get(bgCtx); err == nil {
				var neg Negocio
				negDoc.DataTo(&neg)
				direccion = neg.Direccion
			}
			dur := b.DurationMinute
			if dur <= 0 {
				dur = 60
			}
			newEvt := createCalendarEvent(bgCtx, slug, b.EmpID, b.ServiceName, dur, b.DateTime, b.Notes, b.ClientName, b.UserPhone, direccion)
			if newEvt == "" {
				log.Printf("Aviso: undo %s restauró la cita pero no el evento de Calendar", citaID)
				return
			}
			if _, err := docRef.Update(bgCtx, []firestore.Update{{Path: "calendar_event_id", Value: newEvt}}); err != nil {
				log.Printf("Aviso: no se pudo guardar el evento restaurado de %s: %v", citaID, err)
			}
		}()
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

// marcaReciente dice si una marca de tiempo de Firestore (cancelled_at,
// no_show_at) ocurrió dentro de la ventana. Acepta time.Time (lectura
// directa) y fishtimestamps; ausente o ilegible = false.
func marcaReciente(v interface{}, ventana time.Duration) bool {
	if v == nil {
		return false
	}
	if t, ok := v.(time.Time); ok && !t.IsZero() {
		return time.Since(t) <= ventana
	}
	return false
}

// incrementCliente suma de vuelta una visita y el gasto del servicio al
// directorio de clientes (usado al deshacer cancelación/no-show).
func incrementCliente(ctx context.Context, slug, phone string, price int) {
	if slug == "" || phone == "" {
		return
	}
	ref := firestoreClient.Collection("clientes").Doc(clienteDocID(slug, phone))
	_, err := ref.Set(ctx, clienteCRMData(slug, phone, 1, price), firestore.MergeAll)
	if err != nil {
		log.Printf("Aviso: no se pudo restaurar al cliente %s en %s: %v", phone, slug, err)
	}
}
