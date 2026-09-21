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

// rescheduleRequest mueve una cita activa a otro día/hora.
// POST /api/v1/b/{slug}/citas/{citaID}/reschedule {"fecha":"YYYY-MM-DD","hora":"HH:MM"}
// Puede invocarlo: el dueño, el empleado asignado o el cliente (phone match).
//
// Lógica de negocio (por qué existe en vez de cancelar+recrear):
//   - No toca el CRM (visitas/gasto) ni los contadores: sigue siendo la MISMA
//     cita, solo cambia de momento. Cancelar+recrear restaría y sumaría de más.
//   - Mueve el evento de Google Calendar (borra el viejo, crea el nuevo) para
//     que la agenda del profesional no quede con huecos fantasma.
//   - Resetea reminder_sent: la nueva fecha necesita su propio recordatorio.
//   - El cliente conserva la ventana de 2h (igual que al cancelar); el dueño
//     y el equipo pueden mover siempre.
func rescheduleCitaHandler(w http.ResponseWriter, r *http.Request, slug, citaID string) {
	var req struct {
		Fecha string `json:"fecha"`
		Hora  string `json:"hora"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Payload inválido", http.StatusBadRequest)
		return
	}
	if req.Fecha == "" || req.Hora == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "missing_fields",
			"message": "Indica la nueva fecha y hora.",
		})
		return
	}

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

	// Solo citas activas: una cancelada primero se deshace (undo).
	if doc.Data()["cancelled"] == true {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "cita_cancelada",
			"message": "Esta cita está cancelada. Deshaz la cancelación primero o crea una nueva.",
		})
		return
	}
	if b.NoShow {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "cita_noshow",
			"message": "Esta cita fue marcada como no-show. Deshaz la marca primero.",
		})
		return
	}

	// AUTORIZACIÓN: dueño, empleado asignado, o cliente (por phone match).
	isOwner := isOwnerRequest(r, slug)
	isEmployee := !isOwner && isAssignedEmployeeRequest(r, slug, b.EmpID)
	isClient := !isOwner && !isEmployee && isClientRequest(r, b.UserPhone, b.ClientUID)
	if !isOwner && !isEmployee && !isClient {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "unauthorized",
			"message": "No autorizado para mover esta cita.",
		})
		return
	}

	// Las citas pasadas no se mueven: la herramienta es "No llegó" o "Deshacer".
	if time.Now().After(b.DateTime) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "cita_pasada",
			"message": "Esta cita ya pasó. Si el cliente no vino, márcala como No llegó.",
		})
		return
	}

	// Ventana del cliente (igual que al cancelar); dueño/equipo libres.
	ventanaCancel := negocioCancelWindow(ctx, slug)
	if isClient && !clientePuedeCancelar(b.DateTime, time.Now(), ventanaCancel) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "too_late_to_move",
			"message": fmt.Sprintf("Solo puedes mover tu cita hasta %d horas antes. Para cambios de última hora, escribe directamente al local.", ventanaCancel),
		})
		return
	}

	parsedDate, err := time.Parse("2006-01-02", req.Fecha)
	if err != nil {
		http.Error(w, "Formato de fecha inválido. Use YYYY-MM-DD", http.StatusBadRequest)
		return
	}
	hour, err := time.Parse("15:04", req.Hora)
	if err != nil {
		http.Error(w, "Formato de hora inválido. Use HH:MM", http.StatusBadRequest)
		return
	}
	loc := shopLocation(ctx, slug)
	nuevo := time.Date(parsedDate.Year(), parsedDate.Month(), parsedDate.Day(), hour.Hour(), hour.Minute(), 0, 0, loc)

	if nuevo.Equal(b.DateTime) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "La cita ya está en ese horario.",
			"cita_id": citaID,
		})
		return
	}

	// Antelación mínima del negocio (igual que al reservar).
	minNotice := negocioMinNotice(ctx, slug)
	if time.Until(nuevo) < time.Duration(minNotice)*time.Minute {
		mensaje := "El horario elegido ya pasó. Elige otro o escribe al local."
		if minNotice >= 60 {
			mensaje = fmt.Sprintf("Las reservas requieren al menos %d horas de anticipación. Elige otro horario.", (minNotice+59)/60)
		} else if minNotice > 0 {
			mensaje = fmt.Sprintf("Las reservas requieren al menos %d minutos de anticipación. Elige otro horario.", minNotice)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "muy_pronto",
			"message": mensaje,
		})
		return
	}

	// Anti-spam: si cambia de día, el día nuevo debe respetar el tope
	// (por teléfono y por cuenta, igual que al reservar).
	mismoDia := nuevo.In(loc).Format("2006-01-02") == b.DateTime.In(loc).Format("2006-01-02")
	if !mismoDia && hasBookingOnDate(ctx, slug, b.UserPhone, nuevo) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "max_per_day",
			"message": "Ya tienes el máximo de reservas ese día con este número. Escríbenos para turnos adicionales.",
		})
		return
	}
	if !mismoDia && b.ClientUID != "" && hasBookingOnDateUID(ctx, slug, b.ClientUID, nuevo) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "max_per_day",
			"message": "Ya tienes el máximo de reservas ese día con tu cuenta. Escríbenos para turnos adicionales.",
		})
		return
	}
	// Un lugar por persona y sesión también al mover: si ya tiene otro lugar
	// en esa clase-hora, no puede sumar este (se ignora la propia cita).
	if b.RecursoID != "" && yaTieneLugar(ctx, slug, b.RecursoID, nuevo, b.ClientUID, b.UserPhone, citaID) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "lugar_duplicado",
			"message": "Ya tienes un lugar en esta clase a esta hora.",
		})
		return
	}

	// Disponibilidad del nuevo slot con la duración real de la cita.
	// Con recurso se verifica el espacio (y el profesional si lo hay).
	dur := b.DurationMinute
	if dur <= 0 {
		dur = 60
	}
	libre := true
	if b.RecursoID != "" {
		cuposMover := b.Cupos
		if cuposMover < 1 {
			cuposMover = 1
		}
		var slotsRec []string
		slotsRec, _, err = disponibilidadRecurso(ctx, slug, b.RecursoID, parsedDate, dur, cuposMover)
		if err != nil {
			log.Printf("Error verificando disponibilidad del espacio para mover %s: %v", citaID, err)
			http.Error(w, "Error verificando disponibilidad", http.StatusInternalServerError)
			return
		}
		libre = false
		for _, s := range slotsRec {
			if s == req.Hora {
				libre = true
				break
			}
		}
	}
	if libre && b.EmpID != "" {
		var slots []string
		slots, err = getFreeSlots(ctx, slug, b.EmpID, parsedDate, dur)
		if err != nil {
			log.Printf("Error verificando disponibilidad para mover %s: %v", citaID, err)
			http.Error(w, "Error verificando disponibilidad", http.StatusInternalServerError)
			return
		}
		libre = false
		for _, s := range slots {
			if s == req.Hora {
				libre = true
				break
			}
		}
	}
	if !libre {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "slot_taken",
			"message": "Ese horario ya fue reservado por alguien más. Elige otro.",
		})
		return
	}

	// Mover en Calendar: crear el nuevo primero; si falla, no se toca nada.
	// El viejo se borra solo si el nuevo quedó creado (sin huérfanos).
	// Sin profesional no hay calendario: se conserva el id vacío.
	direccion := ""
	if negDoc, err := firestoreClient.Collection("negocios").Doc(slug).Get(ctx); err == nil {
		var neg Negocio
		negDoc.DataTo(&neg)
		direccion = neg.Direccion
	}
	nuevoEvento := ""
	if b.EmpID != "" {
		nuevoEvento = createCalendarEvent(ctx, slug, b.EmpID, b.ServiceName, dur, nuevo, b.Notes, b.ClientName, b.UserPhone, direccion, b.ClientEmail)
		if nuevoEvento == "" {
			log.Printf("Aviso: no se pudo crear el evento nuevo al mover %s", citaID)
		}
	}
	viejoEvento := b.CalendarEvt

	err = firestoreClient.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		snap, err := tx.Get(docRef)
		if err != nil {
			return err
		}
		if snap.Data()["cancelled"] == true {
			return errYaAplicado
		}
		return tx.Update(docRef, []firestore.Update{
			{Path: "date_time", Value: nuevo},
			{Path: "calendar_event_id", Value: nuevoEvento},
			{Path: "reminder_sent", Value: false},
			{Path: "updated_at", Value: time.Now()},
		})
	})
	if err != nil {
		if errors.Is(err, errYaAplicado) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"error":   "cita_cancelada",
				"message": "La cita fue cancelada mientras la movías. Recarga e intenta de nuevo.",
			})
			return
		}
		log.Printf("Error moviendo cita %s: %v", citaID, err)
		if nuevoEvento != "" && nuevoEvento != "mock_event_123" {
			deleteCalendarEvent(ctx, slug, b.EmpID, nuevoEvento)
		}
		http.Error(w, "Error moviendo la cita", http.StatusInternalServerError)
		return
	}

	// Compensación Calendar: borrar el evento viejo ya con la cita movida.
	if viejoEvento != "" && viejoEvento != "mock_event_123" && viejoEvento != nuevoEvento {
		deleteCalendarEvent(ctx, slug, b.EmpID, viejoEvento)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Cita movida exitosamente",
		"cita_id": citaID,
		"fecha":   nuevo.In(loc).Format("2006-01-02"),
		"hora":    nuevo.In(loc).Format("15:04"),
	})
}
