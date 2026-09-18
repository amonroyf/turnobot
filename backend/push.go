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

	// Guardar el token en el doc privado (nunca en el negocio público):
	// ArrayUnion a push_tokens (multi-dispositivo) y push_token legacy.
	// Además borra los campos legacy del doc público por si existían.
	_, err := privadoNotificacionesRef(slug).Set(r.Context(), map[string]interface{}{
		"push_tokens": firestore.ArrayUnion(req.Token),
		"push_token":  req.Token,
	}, firestore.MergeAll)
	if err != nil {
		log.Printf("Error guardando push token para %s: %v", slug, err)
		http.Error(w, "Error guardando token", http.StatusInternalServerError)
		return
	}
	_, _ = firestoreClient.Collection("negocios").Doc(slug).Update(r.Context(), []firestore.Update{
		{Path: "push_token", Value: firestore.Delete},
		{Path: "push_tokens", Value: firestore.Delete},
	})

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
	tokens := ownerPushTokens(ctx, slug)
	if len(tokens) == 0 {
		log.Printf("sendPush: negocio %s no tiene push_token registrado", slug)
		return
	}

	title := fmt.Sprintf("📅 Nueva reserva de %s", clientName)
	body := fmt.Sprintf("%s — %s a las %s", serviceName, dateStr, timeStr)

	// Solo-data: el service worker (firebase-messaging-sw.js) renderiza la
	// notificación manualmente leyendo payload.data. No usar
	// Webpush.Notification (ver nota en el comentario de la función).
	for _, tok := range tokens {
		sent, gone := sendPushToClient(ctx, tok, title, body, "/admin", "new-booking")
		if sent {
			log.Printf("sendPush: notificación enviada a %s", slug)
			continue
		}
		if gone {
			clearOwnerToken(ctx, slug, tok)
		}
	}
}

// sendPushToEmployee envía un aviso al profesional (reserva nueva o próxima
// cita) a la URL de su portal. Si el token está muerto se limpia del empleado.
// Retorna true si FCM lo aceptó.
func sendPushToEmployee(ctx context.Context, slug, empID, token, title, body, tag string) bool {
	if strings.TrimSpace(token) == "" {
		return false
	}
	sent, gone := sendPushToClient(ctx, token, title, body, "/employee/"+slug, tag)
	if gone {
		if _, err := firestoreClient.Collection("negocios").Doc(slug).Collection("empleados").Doc(empID).Update(ctx, []firestore.Update{
			{Path: "push_token", Value: ""},
		}); err != nil {
			log.Printf("empPush: no se pudo limpiar token muerto %s/%s: %v", slug, empID, err)
		} else {
			log.Printf("empPush: token muerto eliminado %s/%s", slug, empID)
		}
	}
	return sent
}

// Tokens del dueño: viven en negocios/{slug}/privado/notificaciones
// (push_token legacy + push_tokens multi-dispositivo). NUNCA en el doc
// público del negocio: las reglas lo dejan leer sin auth para la página de
// reservas, y los tokens FCM no deben ser visibles públicamente.
// Los campos viejos (push_token/push_tokens en el negocio) se leen como
// fallback y se migran solos al primer uso.
func privadoNotificacionesRef(slug string) *firestore.DocumentRef {
	return firestoreClient.Collection("negocios").Doc(slug).Collection("privado").Doc("notificaciones")
}

// ownerPushTokens devuelve los tokens del dueño sin duplicados, leyendo el
// doc privado y migrando los campos legacy si aún existen.
func ownerPushTokens(ctx context.Context, slug string) []string {
	seen := map[string]bool{}
	out := []string{}
	agregar := func(t string) {
		t = strings.TrimSpace(t)
		if t != "" && !seen[t] {
			seen[t] = true
			out = append(out, t)
		}
	}

	if doc, err := privadoNotificacionesRef(slug).Get(ctx); err == nil {
		var priv struct {
			PushToken  string   `firestore:"push_token"`
			PushTokens []string `firestore:"push_tokens"`
		}
		doc.DataTo(&priv)
		agregar(priv.PushToken)
		for _, t := range priv.PushTokens {
			agregar(t)
		}
		if len(out) > 0 {
			return out
		}
	}

	// Fallback legacy: campos en el doc del negocio (versiones viejas).
	// Si hay, se migran al privado y se borran del doc público.
	if doc, err := firestoreClient.Collection("negocios").Doc(slug).Get(ctx); err == nil {
		var neg Negocio
		doc.DataTo(&neg)
		for _, t := range ownerTokens(neg) {
			agregar(t)
		}
		if len(out) > 0 {
			go migrarTokensPrivado(slug, out)
		}
	}
	return out
}

// ownerTokens devuelve los tokens legacy del doc del negocio sin duplicados.
// Solo se usa como fallback de migración (los nuevos viven en el privado).
func ownerTokens(neg Negocio) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, t := range append([]string{neg.PushToken}, neg.PushTokens...) {
		t = strings.TrimSpace(t)
		if t != "" && !seen[t] {
			seen[t] = true
			out = append(out, t)
		}
	}
	return out
}

// migrarTokensPrivado mueve los tokens legacy al doc privado y los borra del
// doc público. Best-effort en background.
func migrarTokensPrivado(slug string, tokens []string) {
	ctx := context.Background()
	if _, err := privadoNotificacionesRef(slug).Set(ctx, map[string]interface{}{
		"push_tokens": tokens,
		"push_token":  tokens[0],
		"migrado_at":  time.Now(),
	}, firestore.MergeAll); err != nil {
		log.Printf("push: no se pudo migrar tokens de %s: %v", slug, err)
		return
	}
	if _, err := firestoreClient.Collection("negocios").Doc(slug).Update(ctx, []firestore.Update{
		{Path: "push_token", Value: firestore.Delete},
		{Path: "push_tokens", Value: firestore.Delete},
	}); err != nil {
		log.Printf("push: no se pudieron limpiar tokens legacy de %s: %v", slug, err)
	}
}

// isTokenGone detecta errores FCM de token inválido, revocado o expirado
// (app desinstalada, PWA borrada, token rotado). Esos tokens nunca volverán
// a funcionar: hay que limpiarlos en vez de reintentar eternamente.
func isTokenGone(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "Requested entity was not found") ||
		strings.Contains(msg, "UNREGISTERED") ||
		strings.Contains(msg, "registration-token-not-registered")
}

// clearOwnerToken elimina un token muerto del doc privado e invalida la caché.
func clearOwnerToken(ctx context.Context, slug, tok string) {
	if _, err := privadoNotificacionesRef(slug).Update(ctx, []firestore.Update{
		{Path: "push_tokens", Value: firestore.ArrayRemove(tok)},
	}); err != nil {
		log.Printf("sendPush: no se pudo limpiar token muerto en %s: %v", slug, err)
		return
	}
	// Limpieza legacy por si el token vivía en el doc público.
	_, _ = firestoreClient.Collection("negocios").Doc(slug).Update(ctx, []firestore.Update{
		{Path: "push_tokens", Value: firestore.ArrayRemove(tok)},
	})
	negocioCache.Invalidate(slug)
	log.Printf("sendPush: token muerto eliminado en %s", slug)
}

// sendPushToClient envía un mensaje push solo-data a un token arbitrario.
// Retorna true si FCM lo aceptó. Es la primitiva que usa el cron de
// recordatorios tanto para clientes como para resúmenes del dueño.
// Solo-data a propósito (ver nota en sendPushToOwner): el service worker
// renderiza la notificación una sola vez leyendo payload.data.
func sendPushToClient(ctx context.Context, token, title, body, url, tag string) (sent, gone bool) {
	if token == "" {
		return false, false
	}
	fcmClient, err := firebaseApp.Messaging(ctx)
	if err != nil {
		log.Printf("sendPushToClient: error creando cliente FCM: %v", err)
		return false, false
	}
	msg := &messaging.Message{
		Token: token,
		Webpush: &messaging.WebpushConfig{
			// Urgencia alta: despierta el service worker en background
			// aunque el sistema esté en Doze/ahorro (Android).
			Headers: map[string]string{"Urgency": "high"},
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
		return false, isTokenGone(err)
	}
	log.Printf("sendPushToClient: notificación enviada (tag=%s message_id=%s)", tag, resp)
	return true, false
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

// sendPushToOwnerCancellation envía un push al dueño cuando un CLIENTE cancela
// su propia cita. Notifica a TODOS sus dispositivos para que sepa que el
// hueco se liberó.
func sendPushToOwnerCancellation(ctx context.Context, slug, clientName, serviceName, dateStr, timeStr string) {
	tokens := ownerPushTokens(ctx, slug)
	if len(tokens) == 0 {
		return
	}
	fcmClient, err := firebaseApp.Messaging(ctx)
	if err != nil {
		return
	}
	title := "❌ Cita cancelada por cliente"
	body := fmt.Sprintf("%s canceló %s (%s a las %s)", clientName, serviceName, dateStr, timeStr)
	for _, tok := range tokens {
		msg := &messaging.Message{
			Token: tok,
			Webpush: &messaging.WebpushConfig{
				Data: map[string]string{
					"title": title,
					"body":  body,
					"icon":  "/icons/icon-192x192.png",
					"url":   "/admin",
					"tag":   "cancellation",
				},
			},
		}
		resp, err := fcmClient.Send(ctx, msg)
		if err != nil {
			log.Printf("sendPushToOwnerCancellation: error enviando push a %s: %v", slug, err)
			if isTokenGone(err) {
				clearOwnerToken(ctx, slug, tok)
			}
			continue
		}
		log.Printf("sendPushToOwnerCancellation: notificación enviada a %s (message_id=%s)", slug, resp)
	}
}

// registerClientPushTokenRequest es el payload que envía el frontend del
// cliente cuando activa el recordatorio después de agendar.
type registerClientPushTokenRequest struct {
	Token string `json:"token"`
	// Phone verifica que quien registra es el dueño de la cita (endurece el
	// endpoint sin auth: se compara por dígitos contra user_phone).
	Phone string `json:"phone,omitempty"`
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

	// El teléfono debe coincidir con el de la reserva: evita que cualquiera
	// con el citaID pise el token de otro cliente. Se compara contra todas
	// las variantes (E.164, nacional) porque el frontend manda dígitos
	// nacionales y el backend guarda E.164.
	match := false
	if want := digitsOnly(req.Phone); want != "" {
		for _, key := range phoneQueryKeys(b.UserPhone) {
			if digitsOnly(key) == want {
				match = true
				break
			}
		}
	}
	if !match {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "telefono_no_coincide",
			"message": "El teléfono no coincide con el de la reserva.",
		})
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

	// Se resetea reminder_sent: si el cron ya pasó por esta cita (sin token),
	// el recordatorio debe enviarse igual ahora que hay a dónde enviarlo.
	_, err = docRef.Update(ctx, []firestore.Update{
		{Path: "client_push_token", Value: req.Token},
		{Path: "reminder_sent", Value: false},
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

// sendTestPushHandler envía un push de prueba a todos los dispositivos del
// dueño para verificar que las notificaciones llegan a este celular.
// POST /api/v1/b/{slug}/push-test — solo el dueño (Firebase ID token).
func sendTestPushHandler(w http.ResponseWriter, r *http.Request, slug string) {
	if !isOwnerRequest(r, slug) {
		http.Error(w, "No autorizado", http.StatusUnauthorized)
		return
	}
	ctx := r.Context()
	tokens := ownerPushTokens(ctx, slug)
	sent := 0
	for _, tok := range tokens {
		if ok, gone := sendPushToClient(ctx, tok,
			"🔔 Prueba de notificaciones",
			"Si ves este mensaje, las notificaciones funcionan en este dispositivo.",
			"/admin", "push-test"); ok {
			sent++
		} else if gone {
			clearOwnerToken(ctx, slug, tok)
		}
	}
	log.Printf("push-test: %d/%d enviados a %s", sent, len(tokens), slug)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"sent":    sent,
		"total":   len(tokens),
		"message": "Prueba enviada",
	})
}

// unregisterPushTokenHandler elimina el token FCM de un dispositivo del dueño
// para que deje de recibir pushes (el "Desactivar" del panel antes solo
// borraba localStorage y el backend seguía enviando).
// DELETE /api/v1/b/{slug}/push-token — body opcional {token}: si viene, se
// elimina solo ese dispositivo; si no, se eliminan todos los del negocio.
// Solo el dueño (Firebase ID token).
func unregisterPushTokenHandler(w http.ResponseWriter, r *http.Request, slug string) {
	if !isOwnerRequest(r, slug) {
		http.Error(w, "No autorizado", http.StatusUnauthorized)
		return
	}

	var req struct {
		Token string `json:"token"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req) // best effort: sin body = todos
	tok := strings.TrimSpace(req.Token)

	ctx := r.Context()
	updates := []firestore.Update{}
	if tok == "" {
		// Sin token: se borra el doc privado completo (todos los dispositivos)
		// más los campos legacy del doc público por si existían.
		if _, err := privadoNotificacionesRef(slug).Delete(ctx); err != nil {
			log.Printf("push-token: no se pudo borrar doc privado de %s: %v", slug, err)
		}
		updates = append(updates,
			firestore.Update{Path: "push_token", Value: firestore.Delete},
			firestore.Update{Path: "push_tokens", Value: firestore.Delete},
		)
	} else {
		if _, err := privadoNotificacionesRef(slug).Update(ctx, []firestore.Update{
			{Path: "push_tokens", Value: firestore.ArrayRemove(tok)},
		}); err != nil {
			log.Printf("push-token: no se pudo quitar token en %s: %v", slug, err)
		}
		updates = append(updates,
			firestore.Update{Path: "push_tokens", Value: firestore.ArrayRemove(tok)},
		)
	}

	if _, err := firestoreClient.Collection("negocios").Doc(slug).Update(ctx, updates); err != nil {
		log.Printf("Error borrando push token para %s: %v", slug, err)
		http.Error(w, "Error eliminando token", http.StatusInternalServerError)
		return
	}

	negocioCache.Invalidate(slug)
	log.Printf("push-token: token(s) eliminados para %s (uno=%v)", slug, tok != "")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Notificaciones desactivadas en este dispositivo",
	})
}
