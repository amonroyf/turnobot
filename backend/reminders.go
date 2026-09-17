package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"time"

	"cloud.google.com/go/firestore"
)

// maxReminderScan acota la ventana de búsqueda en Firestore. La ventana real
// por cita la define cada negocio (reminder_hours_before, default 2h).
const maxReminderScan = 6 * time.Hour

// maxRemindersPerRun acota el trabajo por ejecución para no exceder el
// WriteTimeout del servidor (15s) si algún día hay muchas citas juntas.
const maxRemindersPerRun = 50

// dueReminder empareja una reserva próxima con su referencia para marcarla.
type dueReminder struct {
	ref *firestore.DocumentRef
	id  string
	b   Booking
}

// checkRemindersHandler procesa los recordatorios de citas próximas.
// POST /api/v1/check-reminders?dry_run=true
// Lo invoca Cloud Scheduler cada 15 min con header X-Cron-Secret. El super
// admin también puede invocarlo (pruebas manuales).
// Por cada cita futura dentro de la ventana del negocio (reminder_hours_before):
//  1. Push al cliente si registró token al reservar ("avísame").
//  2. Un solo push resumen al dueño con sus citas próximas (si tiene push_token).
//  3. Marca reminder_sent=true para no repetir.
// Con ?dry_run=true calcula y responde sin enviar ni marcar.
func checkRemindersHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Método no permitido", http.StatusMethodNotAllowed)
		return
	}

	secret := os.Getenv("CRON_SECRET")
	authorized := secret != "" && r.Header.Get("X-Cron-Secret") == secret
	if !authorized && !isSuperAdminRequest(r) {
		http.Error(w, "No autorizado", http.StatusUnauthorized)
		return
	}

	dryRun := r.URL.Query().Get("dry_run") == "true"
	ctx := r.Context()
	now := time.Now()

	docs, err := firestoreClient.Collection("reservas").
		Where("date_time", ">=", now).
		Where("date_time", "<=", now.Add(maxReminderScan)).
		Documents(ctx).GetAll()
	if err != nil {
		log.Printf("checkReminders: error consultando reservas: %v", err)
		http.Error(w, "Error consultando citas", http.StatusInternalServerError)
		return
	}

	byNeg := map[string][]dueReminder{}
	for _, d := range docs {
		if d.Data()["cancelled"] == true {
			continue
		}
		var b Booking
		if err := d.DataTo(&b); err != nil {
			continue
		}
		if b.ReminderSent || b.NegocioID == "" || !b.DateTime.After(now) {
			continue
		}
		byNeg[b.NegocioID] = append(byNeg[b.NegocioID], dueReminder{ref: d.Ref, id: d.Ref.ID, b: b})
	}

	type previewItem struct {
		CitaID     string `json:"cita_id"`
		Negocio    string `json:"negocio_id"`
		Cliente    string `json:"cliente"`
		Servicio   string `json:"servicio"`
		FechaHora  string `json:"fecha_hora"`
		ClientPush bool   `json:"client_push"`
	}
	preview := []previewItem{}
	clientOK, clientFail, ownersOK, marked := 0, 0, 0, 0
	truncated := false
	batch := firestoreClient.Batch()

outer:
	for slug, list := range byNeg {
		negDoc, err := firestoreClient.Collection("negocios").Doc(slug).Get(ctx)
		if err != nil {
			log.Printf("checkReminders: negocio %s no encontrado, se omite", slug)
			continue
		}
		var neg Negocio
		negDoc.DataTo(&neg)
		_, hours := negocioReminders(ctx, slug)
		if hours <= 0 {
			hours = 2
		}
		if hours > int(maxReminderScan/time.Hour) {
			hours = int(maxReminderScan / time.Hour)
		}
		window := time.Duration(hours) * time.Hour
		loc := shopLocation(ctx, slug)
		negName := neg.Name
		if negName == "" {
			negName = slug
		}

		sort.Slice(list, func(i, j int) bool { return list[i].b.DateTime.Before(list[j].b.DateTime) })

		ownerLines := []string{}
		for _, it := range list {
			if it.b.DateTime.Sub(now) > window {
				continue // fuera de la ventana configurada por el negocio
			}
			hora := it.b.DateTime.In(loc).Format("15:04")
			fecha := it.b.DateTime.In(loc).Format("02/01")

			if dryRun {
				preview = append(preview, previewItem{
					CitaID: it.id, Negocio: slug,
					Cliente: it.b.ClientName, Servicio: it.b.ServiceName,
					FechaHora: fecha + " " + hora,
					ClientPush: it.b.ClientPushToken != "",
				})
				continue
			}
			if marked >= maxRemindersPerRun {
				truncated = true
				break outer
			}

			if it.b.ClientPushToken != "" {
				title := "⏰ Tu cita es hoy"
				if it.b.DateTime.In(loc).Format("2006-01-02") != now.In(loc).Format("2006-01-02") {
					title = "⏰ Recordatorio de tu cita"
				}
				body := fmt.Sprintf("%s en %s, %s a las %s", it.b.ServiceName, negName, fecha, hora)
				sent, gone := sendPushToClient(ctx, it.b.ClientPushToken, title, body, "/shop/"+slug, "reminder-"+it.id)
				if sent {
					clientOK++
				} else {
					clientFail++
				}
				if gone {
					// Token muerto: se limpia y se marca para no reintentar.
					batch.Update(it.ref, []firestore.Update{
						{Path: "client_push_token", Value: firestore.Delete},
						{Path: "reminder_sent", Value: true},
					})
					marked++
				} else if sent {
					batch.Update(it.ref, []firestore.Update{{Path: "reminder_sent", Value: true}})
					marked++
				}
				// Fallo transitorio: se deja sin marcar para reintentar en
				// la próxima corrida mientras siga en ventana.
			} else {
				// Sin token no hay nada que enviar: se marca para no reescanear.
				// (Si el cliente activa el aviso después, el endpoint resetea
				// reminder_sent y el cron la retoma.)
				batch.Update(it.ref, []firestore.Update{{Path: "reminder_sent", Value: true}})
				marked++
			}
			ownerLines = append(ownerLines, fmt.Sprintf("%s %s (%s)", hora, it.b.ClientName, it.b.ServiceName))
		}

		if !dryRun && len(ownerLines) > 0 {
			if tokens := ownerTokens(neg); len(tokens) > 0 {
				title := fmt.Sprintf("📋 %d citas próximas en %s", len(ownerLines), negName)
				shown := ownerLines
				extra := ""
				if len(shown) > 3 {
					shown = shown[:3]
					extra = fmt.Sprintf("\ny %d más…", len(ownerLines)-3)
				}
				body := ""
				for i, ln := range shown {
					if i > 0 {
						body += "\n"
					}
					body += "• " + ln
				}
				body += extra
				for _, tok := range tokens {
					sent, gone := sendPushToClient(ctx, tok, title, body, "/admin", "owner-reminders")
					if sent {
						ownersOK++
					} else if gone {
						clearOwnerToken(ctx, slug, neg, tok)
					}
				}
			}
		}
	}

	if !dryRun && marked > 0 {
		if _, err := batch.Commit(ctx); err != nil {
			log.Printf("checkReminders: error marcando reminder_sent: %v", err)
		}
	}

	log.Printf("checkReminders: dry_run=%v citas=%d client_ok=%d client_fail=%d owners=%d truncated=%v",
		dryRun, marked+len(preview), clientOK, clientFail, ownersOK, truncated)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":         true,
		"dry_run":         dryRun,
		"citas_procesadas": marked,
		"client_ok":       clientOK,
		"client_fail":     clientFail,
		"owners_notified": ownersOK,
		"truncated":       truncated,
		"preview":         preview,
	})
}
