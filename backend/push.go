package main

import (
	"context"
	"fmt"
	"log"

	"firebase.google.com/go/v4/messaging"
)

// sendPush envía una notificación push usando Firebase Admin SDK.
func sendPush(ctx context.Context, token, title, body string, data map[string]string) error {
	if token == "" {
		return fmt.Errorf("token vacío")
	}
	if fcmClient == nil {
		return fmt.Errorf("FCM no inicializado")
	}

	msg := &messaging.Message{
		Token: token,
		Notification: &messaging.Notification{
			Title: title,
			Body:  body,
		},
		Data: data,
		Android: &messaging.AndroidConfig{
			Priority: "high",
		},
		Webpush: &messaging.WebpushConfig{
			Notification: &messaging.WebpushNotification{
				Icon: "/icon-192x192.png",
			},
		},
	}

	_, err := fcmClient.Send(ctx, msg)
	if err != nil {
		log.Printf("Error FCM: %v", err)
	}
	return err
}

// sendPushToNegocio envía push al dueño del negocio usando el token guardado en Firestore.
func sendPushToNegocio(ctx context.Context, slug, title, body string, data map[string]string) error {
	doc, err := firestoreClient.Collection("negocios").Doc(slug).Get(ctx)
	if err != nil {
		return fmt.Errorf("no se pudo leer el negocio: %v", err)
	}
	var neg Negocio
	doc.DataTo(&neg)
	if neg.PushToken == "" {
		return fmt.Errorf("no hay push_token configurado")
	}
	return sendPush(ctx, neg.PushToken, title, body, data)
}
