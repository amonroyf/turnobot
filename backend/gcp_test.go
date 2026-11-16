package main

// Soporte para correr la suite de integración contra un proyecto GCP
// dedicado en lugar del emulador.
//
// Guardias:
//   - GCP_TEST_PROJECT_ID: proyecto destino (obligatorio para activar GCP).
//   - GCP_TEST_ALLOW_WRITES=1: confirma que se pueden escribir/borrar datos.
//   - GCP_TEST_FIREBASE_API_KEY (o FIREBASE_API_KEY): API key web para
//     obtener ID tokens de los usuarios de prueba.
//
// Al terminar, TestMain borra los negocios con prefijo `test-`, sus
// reservas/clientes y los usuarios @test.com. Nunca toca otros datos.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"cloud.google.com/go/firestore"
	"firebase.google.com/go/v4/auth"
	"google.golang.org/api/iterator"
)

func testUsaGCP() bool {
	return os.Getenv("FIRESTORE_EMULATOR_HOST") == "" &&
		os.Getenv("GCP_TEST_PROJECT_ID") != ""
}

func testProjectID() string {
	if testUsaGCP() {
		return os.Getenv("GCP_TEST_PROJECT_ID")
	}
	return "test-turnobot"
}

func testExigirEscrituraGCP(t *testing.T) {
	t.Helper()
	if !testUsaGCP() {
		return
	}
	if os.Getenv("GCP_TEST_ALLOW_WRITES") != "1" {
		t.Fatalf(
			"Modo GCP sin confirmación de escritura. " +
				"Definí GCP_TEST_ALLOW_WRITES=1 sabiendo que la suite crea y borra datos de prueba.",
		)
	}
	if strings.Contains(strings.ToLower(os.Getenv("GCP_TEST_PROJECT_ID")), "prod") {
		t.Fatalf("GCP_TEST_PROJECT_ID parece producción (%q); usá un proyecto dedicado de pruebas",
			os.Getenv("GCP_TEST_PROJECT_ID"))
	}
}

func testAPIKeyGCP(t *testing.T) string {
	t.Helper()
	key := os.Getenv("GCP_TEST_FIREBASE_API_KEY")
	if key == "" {
		key = os.Getenv("FIREBASE_API_KEY")
	}
	if key == "" {
		t.Skip("GCP: falta GCP_TEST_FIREBASE_API_KEY (o FIREBASE_API_KEY) para obtener ID tokens")
	}
	return key
}

// tokenClienteGCP crea (o actualiza) el usuario de prueba y devuelve un ID
// token real de Firebase Auth. Usa email/password para no depender de firmar
// custom tokens con credenciales de usuario (ADC).
func tokenClienteGCP(t *testing.T, email string) string {
	t.Helper()
	if v, ok := clienteTokenCache.Load(email); ok {
		return v.(string)
	}
	const password = "test1234"
	ctx := context.Background()

	user, err := firebaseAuth.GetUserByEmail(ctx, email)
	if err != nil {
		created, cerr := firebaseAuth.CreateUser(ctx, (&auth.UserToCreate{}).
			Email(email).
			Password(password).
			EmailVerified(true))
		if cerr != nil {
			t.Fatalf("GCP: crear usuario %s: %v", email, cerr)
		}
		user = created
	} else {
		if _, uerr := firebaseAuth.UpdateUser(ctx, user.UID, (&auth.UserToUpdate{}).Password(password)); uerr != nil {
			t.Fatalf("GCP: actualizar password de %s: %v", email, uerr)
		}
	}

	data := loginGCP(t, email, password)
	tok, _ := data["idToken"].(string)
	uid, _ := data["localId"].(string)
	if tok == "" || uid == "" {
		t.Fatalf("GCP: login sin idToken/uid para %s", email)
	}
	clienteTokenCache.Store(email, tok)
	clienteUIDCache.Store(email, uid)
	return tok
}

// tokenSuperAdmin devuelve un ID token para el UID super-admin usado por
// TestDeleteNegocioBorraTodo. En GCP crea el usuario con ese UID fijo.
func tokenSuperAdmin(t *testing.T) string {
	t.Helper()
	const (
		uid      = "0FF1nrcBnSPIdB1rMgYocmRnYUb2"
		email    = "superadmin-test@test.com"
		password = "test1234"
	)
	ctx := context.Background()
	if _, err := firebaseAuth.GetUser(ctx, uid); err != nil {
		if _, cerr := firebaseAuth.CreateUser(ctx, (&auth.UserToCreate{}).
			UID(uid).
			Email(email).
			Password(password).
			EmailVerified(true)); cerr != nil {
			t.Fatalf("GCP: crear super-admin: %v", cerr)
		}
	} else if _, uerr := firebaseAuth.UpdateUser(ctx, uid, (&auth.UserToUpdate{}).Password(password)); uerr != nil {
		t.Fatalf("GCP: actualizar super-admin: %v", uerr)
	}

	data := loginGCP(t, email, password)
	tok, _ := data["idToken"].(string)
	if tok == "" {
		t.Fatalf("GCP: sin idToken super-admin")
	}
	return tok
}

func loginGCP(t *testing.T, email, password string) map[string]interface{} {
	t.Helper()
	key := testAPIKeyGCP(t)
	payload := fmt.Sprintf(
		`{"email":%q,"password":%q,"returnSecureToken":true}`,
		email, password,
	)
	res, err := http.Post(
		"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key="+key,
		"application/json",
		strings.NewReader(payload),
	)
	if err != nil {
		t.Fatalf("GCP: login %s: %v", email, err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("GCP: login %s code=%d body=%s", email, res.StatusCode, body)
	}
	var out map[string]interface{}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("GCP: respuesta de login inválida: %v", err)
	}
	return out
}

// TestMain limpia los datos de prueba cuando la suite corrió contra GCP.
func TestMain(m *testing.M) {
	code := m.Run()
	if testUsaGCP() && os.Getenv("GCP_TEST_KEEP_DATA") != "1" {
		if err := limpiarDatosTestGCP(); err != nil {
			fmt.Fprintf(os.Stderr, "limpieza GCP falló: %v\n", err)
			code = 1
		}
	}
	os.Exit(code)
}

func limpiarDatosTestGCP() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	projectID := testProjectID()
	client := firestoreClient
	if client == nil {
		var err error
		client, err = firestore.NewClient(ctx, projectID)
		if err != nil {
			return fmt.Errorf("cliente Firestore: %w", err)
		}
		defer client.Close()
	}

	// Negocios creados por slugUnico("test-...").
	negocios, err := client.Collection("negocios").Documents(ctx).GetAll()
	if err != nil {
		return fmt.Errorf("listar negocios: %w", err)
	}
	for _, doc := range negocios {
		if !strings.HasPrefix(doc.Ref.ID, "test-") {
			continue
		}
		if err := borrarDocRecursivo(ctx, doc.Ref); err != nil {
			return fmt.Errorf("borrar negocio %s: %w", doc.Ref.ID, err)
		}
	}

	// Reservas y clientes de esos negocios.
	for _, col := range []string{"reservas", "clientes"} {
		docs, err := client.Collection(col).Documents(ctx).GetAll()
		if err != nil {
			return fmt.Errorf("listar %s: %w", col, err)
		}
		for _, doc := range docs {
			slug, _ := doc.Data()["negocio_id"].(string)
			if !strings.HasPrefix(slug, "test-") {
				continue
			}
			if _, err := doc.Ref.Delete(ctx); err != nil {
				return fmt.Errorf("borrar %s/%s: %w", col, doc.Ref.ID, err)
			}
		}
	}

	// Usuarios de Auth de la suite (@test.com).
	if firebaseAuth != nil {
		iter := firebaseAuth.Users(ctx, "")
		for {
			user, err := iter.Next()
			if err == iterator.Done {
				break
			}
			if err != nil {
				return fmt.Errorf("listar usuarios Auth: %w", err)
			}
			if strings.HasSuffix(user.Email, "@test.com") {
				if err := firebaseAuth.DeleteUser(ctx, user.UID); err != nil {
					return fmt.Errorf("borrar usuario %s: %w", user.Email, err)
				}
			}
		}
	}

	return nil
}

func borrarDocRecursivo(ctx context.Context, ref *firestore.DocumentRef) error {
	cols, err := ref.Collections(ctx).GetAll()
	if err != nil {
		return err
	}
	for _, col := range cols {
		if err := borrarColeccionRecursiva(ctx, col); err != nil {
			return err
		}
	}
	_, err = ref.Delete(ctx)
	return err
}

func borrarColeccionRecursiva(ctx context.Context, col *firestore.CollectionRef) error {
	docs, err := col.Documents(ctx).GetAll()
	if err != nil {
		return err
	}
	for _, doc := range docs {
		if err := borrarDocRecursivo(ctx, doc.Ref); err != nil {
			return err
		}
	}
	return nil
}
