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

// checkRemindersHandler verifica si hay citas próximas y envía notificaciones push al dueño.
// GET /api/v1/b/{slug}/check-reminders
func checkRemindersHandler(w http.ResponseWriter, r *http.Request, slug string) {
	ctx := r.Context()
	now := time.Now()

	// Ventana de 30 minutos a 35 minutos para evitar falsos positivos
	windowStart := now.Add(30 * time.Minute)
	windowEnd := now.Add(35 * time.Minute)

	docs, err := firestoreClient.Collection("reservas").
		Where("negocio_id", "==", slug).
		Where("date_time", ">=", windowStart).
		Where("date_time", "<", windowEnd).
		Documents(ctx).GetAll()
	if err != nil {
		log.Printf("Error buscando recordatorios: %v", err)
		http.Error(w, "Error buscando recordatorios", http.StatusInternalServerError)
		return
	}

	sent := 0
	for _, d := range docs {
		var b Booking
		d.DataTo(&b)

		// Verificar si ya se envió notificación
		notifSent := d.Data()["notification_sent"]
		if notifSent != nil {
			continue
		}

		// Obtener token del dueño
		negDoc, err := firestoreClient.Collection("negocios").Doc(slug).Get(ctx)
		if err != nil {
			log.Printf("Error leyendo negocio para push: %v", err)
			continue
		}
		var neg Negocio
		negDoc.DataTo(&neg)
		if neg.PushToken == "" {
			log.Printf("No hay push_token para %s", slug)
			continue
		}

		// Obtener nombre del servicio y profesional
		servName := b.ServiceName
		empName := ""
		if b.EmpID != "" {
			empDoc, _ := firestoreClient.Collection("negocios").Doc(slug).Collection("empleados").Doc(b.EmpID).Get(ctx)
			if empDoc.Exists() {
				var emp Employee
				empDoc.DataTo(&emp)
				empName = emp.Name
			}
		}

		title := "🔔 Recordatorio de cita"
		body := fmt.Sprintf("%s con %s en %s", servName, empName, b.DateTime.Format("15:04"))
		data := map[string]string{
			"cita_id": d.Ref.ID,
			"slug":    slug,
			"type":    "reminder",
		}

		err = sendPush(ctx, neg.PushToken, title, body, data)
		if err != nil {
			log.Printf("Error enviando push: %v", err)
			continue
		}

		// Marcar como notificado para no enviar doble
		_, err = d.Ref.Update(ctx, []firestore.Update{
			{Path: "notification_sent", Value: true},
		})
		if err != nil {
			log.Printf("Error marcando notificación como enviada: %v", err)
		}
		sent++
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"sent":    sent,
		"checked": len(docs),
	})
}

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

	// Push al cliente: notificación de no-show (asíncrono)
	if b.ClientPushToken != "" {
		go func() {
			sendPush(context.Background(), b.ClientPushToken,
				"⚠️ No te presentaste",
				fmt.Sprintf("No te presentaste a tu cita de %s. Si deseas reagendar, contacta al local.", b.ServiceName),
				map[string]string{"slug": slug, "type": "no_show"},
			)
		}()
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

// registerPushTokenHandler permite al frontend registrar el token FCM del dueño.
// POST /api/v1/b/{slug}/register-push-token
func registerPushTokenHandler(w http.ResponseWriter, r *http.Request, slug string) {
	ctx := r.Context()

	type payload struct {
		Token string `json:"token"`
	}
	var p payload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		http.Error(w, "Payload inválido", http.StatusBadRequest)
		return
	}
	if p.Token == "" {
		http.Error(w, "Token vacío", http.StatusBadRequest)
		return
	}

	_, err := firestoreClient.Collection("negocios").Doc(slug).Update(ctx, []firestore.Update{
		{Path: "push_token", Value: p.Token},
	})
	if err != nil {
		log.Printf("Error guardando push_token: %v", err)
		http.Error(w, "Error guardando token", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Push token registrado",
	})
}

// registerClientPushTokenHandler guarda el push token del cliente en sus citas
// futuras para que pueda recibir recordatorios y notificaciones de cancelación.
// POST /api/v1/b/{slug}/register-client-push
func registerClientPushTokenHandler(w http.ResponseWriter, r *http.Request, slug string) {
	ctx := r.Context()

	type payload struct {
		Token string `json:"token"`
	}
	var p payload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		http.Error(w, "Payload inválido", http.StatusBadRequest)
		return
	}
	if p.Token == "" {
		http.Error(w, "Token vacío", http.StatusBadRequest)
		return
	}

	// Actualizar todas las citas futuras de este token con el client_push_token
	docs, err := firestoreClient.Collection("reservas").
		Where("negocio_id", "==", slug).
		Where("date_time", ">", time.Now()).
		Documents(ctx).GetAll()
	if err != nil {
		log.Printf("Error buscando citas para registrar push del cliente: %v", err)
		http.Error(w, "Error buscando citas", http.StatusInternalServerError)
		return
	}

	updated := 0
	for _, d := range docs {
		var b Booking
		d.DataTo(&b)
		if b.ClientPushToken == p.Token {
			continue // Ya tiene el token
		}
		_, err := d.Ref.Update(ctx, []firestore.Update{
			{Path: "client_push_token", Value: p.Token},
		})
		if err != nil {
			log.Printf("Error actualizando client_push_token en cita %s: %v", d.Ref.ID, err)
			continue
		}
		updated++
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Push token del cliente registrado",
		"updated": updated,
	})
}

// checkClientRemindersHandler verifica citas próximas y envía recordatorios push
// a los clientes que tengan client_push_token configurado.
// GET /api/v1/b/{slug}/check-client-reminders
func checkClientRemindersHandler(w http.ResponseWriter, r *http.Request, slug string) {
	ctx := r.Context()
	now := time.Now()

	// Ventana de 55 a 65 minutos para recordar al cliente 1 hora antes
	windowStart := now.Add(55 * time.Minute)
	windowEnd := now.Add(65 * time.Minute)

	docs, err := firestoreClient.Collection("reservas").
		Where("negocio_id", "==", slug).
		Where("date_time", ">=", windowStart).
		Where("date_time", "<", windowEnd).
		Documents(ctx).GetAll()
	if err != nil {
		log.Printf("Error buscando recordatorios de cliente: %v", err)
		http.Error(w, "Error buscando recordatorios", http.StatusInternalServerError)
		return
	}

	sent := 0
	for _, d := range docs {
		var b Booking
		d.DataTo(&b)

		// Verificar si ya se envió recordatorio al cliente
		notifSent := d.Data()["client_reminder_sent"]
		if notifSent != nil {
			continue
		}

		// Solo enviar si el cliente tiene push token
		if b.ClientPushToken == "" {
			continue
		}

		// Obtener nombre del negocio
		negDoc, err := firestoreClient.Collection("negocios").Doc(slug).Get(ctx)
		if err != nil {
			continue
		}
		var neg Negocio
		negDoc.DataTo(&neg)

		loc := shopLocation(ctx, slug)
		title := "⏰ Recordatorio de cita"
		body := fmt.Sprintf("Tu cita de %s es a las %s en %s", b.ServiceName, b.DateTime.In(loc).Format("15:04"), neg.Name)
		data := map[string]string{
			"cita_id": d.Ref.ID,
			"slug":    slug,
			"type":    "client_reminder",
		}

		err = sendPush(ctx, b.ClientPushToken, title, body, data)
		if err != nil {
			log.Printf("Error enviando push al cliente: %v", err)
			continue
		}

		// Marcar como enviado
		_, err = d.Ref.Update(ctx, []firestore.Update{
			{Path: "client_reminder_sent", Value: true},
		})
		if err != nil {
			log.Printf("Error marcando recordatorio de cliente como enviado: %v", err)
		}
		sent++
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"sent":    sent,
		"checked": len(docs),
	})
}
