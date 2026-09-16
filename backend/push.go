package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	"firebase.google.com/go/v4/messaging"
)

// registerPushTokenRequest es el payload enviado por el frontend.
type registerPushTokenRequest struct {
	Token string `json:"token"`
}

// registerPushTokenHandler guarda el token FCM del dispositivo del dueño
// en Firestore para que el backend pueda enviarle notificaciones push.
// POST /api/v1/b/{slug}/register-push-token
// Solo el dueño (Firebase ID token) puede registrar su token.
func registerPushTokenHandler(w http.ResponseWriter, r *http.Request, slug string) {
	if !isOwnerRequest(r, slug) {
		http.Error(w, "No autorizado", http.StatusUnauthorized)
		return
	}

	var req registerPushTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "payload_invalido",
			"message": "El body debe contener {\"token\": \"...\"}",
		})
		return
	}

	if req.Token == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "token_requerido",
			"message": "El campo token es requerido",
		})
		return
	}

	// Guardar el token en el documento del negocio
	_, err := firestoreClient.Collection("negocios").Doc(slug).Update(r.Context(), []firestore.Update{
		{Path: "push_token", Value: req.Token},
	})
	if err != nil {
		log.Printf("Error guardando push token para %s: %v", slug, err)
		http.Error(w, "Error guardando token", http.StatusInternalServerError)
		return
	}

	// Invalidar caché para que el próximo request tenga el token actualizado
	negocioCache.Invalidate(slug)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Token push registrado correctamente",
	})
}

// sendPushToOwner envía una notificación push al dueño del negocio cuando
// un cliente reserva una cita. Lee el token FCM del documento del negocio
// y usa Firebase Admin SDK para enviar el mensaje.
// Es fire-and-forget: si falla, solo loguea el error (no bloquea la reserva).
// NOTA: el mensaje es solo-data (sin Webpush.Notification). Con payload
// "notification" el SDK de FCM muestra la notificación automáticamente en
// background Y el service worker la vuelve a mostrar en onBackgroundMessage,
// lo que producía notificaciones duplicadas. Solo-data + render manual en
// firebase-messaging-sw.js = una sola notificación.
func sendPushToOwner(ctx context.Context, slug string, clientName, serviceName, dateStr, timeStr string) {
	negDoc, err := firestoreClient.Collection("negocios").Doc(slug).Get(ctx)
	if err != nil {
		log.Printf("sendPush: no se pudo leer negocio %s: %v", slug, err)
		return
	}

	var neg Negocio
	negDoc.DataTo(&neg)

	if neg.PushToken == "" {
		log.Printf("sendPush: negocio %s no tiene push_token registrado", slug)
		return
	}

	fcmClient, err := firebaseApp.Messaging(ctx)
	if err != nil {
		log.Printf("sendPush: error creando cliente FCM: %v", err)
		return
	}

	title := fmt.Sprintf("📅 Nueva reserva de %s", clientName)
	body := fmt.Sprintf("%s — %s a las %s", serviceName, dateStr, timeStr)

	// Solo-data: el service worker (firebase-messaging-sw.js) renderiza la
	// notificación manualmente leyendo payload.data. No usar
	// Webpush.Notification (ver nota en el comentario de la función).
	msg := &messaging.Message{
		Token: neg.PushToken,
		Webpush: &messaging.WebpushConfig{
			Data: map[string]string{
				"title": title,
				"body":  body,
				"icon":  "/icons/icon-192x192.png",
				"url":   "/admin",
				"tag":   "new-booking",
			},
		},
	}

	resp, err := fcmClient.Send(ctx, msg)
	if err != nil {
		log.Printf("sendPush: error enviando push a %s: %v", slug, err)
		return
	}
	log.Printf("sendPush: notificación enviada a %s (message_id=%s)", slug, resp)
}

// sendPushToClient envía un mensaje push solo-data a un token arbitrario.
// Retorna true si FCM lo aceptó. Es la primitiva que usa el cron de
// recordatorios tanto para clientes como para resúmenes del dueño.
// Solo-data a propósito (ver nota en sendPushToOwner): el service worker
// renderiza la notificación una sola vez leyendo payload.data.
func sendPushToClient(ctx context.Context, token, title, body, url, tag string) bool {
	if token == "" {
		return false
	}
	fcmClient, err := firebaseApp.Messaging(ctx)
	if err != nil {
		log.Printf("sendPushToClient: error creando cliente FCM: %v", err)
		return false
	}
	msg := &messaging.Message{
		Token: token,
		Webpush: &messaging.WebpushConfig{
			Data: map[string]string{
				"title": title,
				"body":  body,
				"icon":  "/icons/icon-192x192.png",
				"url":   url,
				"tag":   tag,
			},
		},
	}
	resp, err := fcmClient.Send(ctx, msg)
	if err != nil {
		log.Printf("sendPushToClient: error enviando push (tag=%s): %v", tag, err)
		return false
	}
	log.Printf("sendPushToClient: notificación enviada (tag=%s message_id=%s)", tag, resp)
	return true
}

// sendReminderToClient envía un recordatorio push al cliente (si tiene token).
// Por ahora es un placeholder: los clientes no tienen token push registrado.
// Se puede extender para SMS/WhatsApp en el futuro.
func sendReminderToClient(ctx context.Context, neg Negocio, b Booking) {
	// Placeholder: envío de recordatorio por WhatsApp (ya integrado vía
	// check-reminders en el CHANGELOG). Push para clientes requiere
	// que instalen la PWA y registren su token.
	_ = neg
	_ = b
	_ = time.Now()
}

// registerClientPushTokenRequest es el payload que envía el frontend del
// cliente cuando activa el recordatorio después de agendar.
type registerClientPushTokenRequest struct {
	Token string `json:"token"`
}

// registerClientPushTokenHandler guarda el token FCM del cliente en la
// reserva para que el cron de recordatorios le envíe un push antes de su cita.
// POST /api/v1/b/{slug}/citas/{citaID}/client-push-token
// No requiere auth: el citaID es un Firestore doc ID difficult to guess,
// y solo se escribe un string (el token). El usuario es el cliente que
// acaba de agendar y está en la pantalla de éxito.
func registerClientPushTokenHandler(w http.ResponseWriter, r *http.Request, slug, citaID string) {
	var req registerClientPushTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "payload_invalido",
			"message": "El body debe contener {\"token\": \"...\"}",
		})
		return
	}

	req.Token = strings.TrimSpace(req.Token)
	if req.Token == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "token_requerido",
			"message": "El campo token es requerido",
		})
		return
	}

	// Sanity check: tokens FCM nunca superan 512 chars.
	if len(req.Token) > 512 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "token_invalido",
			"message": "El token parece inválido",
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

	// Solo guardar si la cita es futura (no tiene sentido un recordatorio
	// para una cita que ya pasó).
	if b.DateTime.Before(time.Now()) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusGone)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "cita_pasada",
			"message": "No se puede activar el recordatorio para una cita que ya pasó.",
		})
		return
	}

	_, err = docRef.Update(ctx, []firestore.Update{
		{Path: "client_push_token", Value: req.Token},
	})
	if err != nil {
		log.Printf("Error guardando client push token para cita %s: %v", citaID, err)
		http.Error(w, "Error guardando token", http.StatusInternalServerError)
		return
	}

	log.Printf("client-push-token: token registrado para cita %s (slug=%s)", citaID, slug)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Recordatorio activado. Te avisaremos antes de tu cita.",
	})
}
