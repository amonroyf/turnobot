package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"os"
	"time"

	"cloud.google.com/go/firestore"
	cloudbuild "google.golang.org/api/cloudbuild/v1"
	"google.golang.org/api/option"
)

var fsClient *firestore.Client

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	ctx := context.Background()
	projectID := os.Getenv("GCP_PROJECT_ID")
	if projectID == "" {
		projectID = "stalwart-coast-439901-d0"
	}

	var err error
	fsClient, err = firestore.NewClient(ctx, projectID)
	if err != nil {
		log.Fatalf("Error inicializando Firestore: %v", err)
	}
	defer fsClient.Close()
	log.Printf("Conectado a Firestore (Proyecto: %s)", projectID)

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/api/tests/run", runTestsHandler)
	mux.HandleFunc("/api/reports", receiveReportHandler)

	mux.HandleFunc("/api/requirements", requirementsHandler)
	mux.HandleFunc("/api/requirements/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/requirements/" || r.URL.Path == "/api/requirements" {
			requirementsHandler(w, r)
			return
		}
		requirementItemHandler(w, r)
	})
	mux.HandleFunc("/api/test-cases", testCasesHandler)
	mux.HandleFunc("/api/test-cases/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/execute") {
			executeTestCaseHandler(w, r)
			return
		}
		if r.URL.Path == "/api/test-cases/" || r.URL.Path == "/api/test-cases" {
			testCasesHandler(w, r)
			return
		}
		testCaseItemHandler(w, r)
	})
	mux.HandleFunc("/api/test-suites", testSuitesHandler)
	mux.HandleFunc("/api/test-suites/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/test-suites/" || r.URL.Path == "/api/test-suites" {
			testSuitesHandler(w, r)
			return
		}
		testSuiteItemHandler(w, r)
	})
	mux.HandleFunc("/api/defects", defectsHandler)
	mux.HandleFunc("/api/defects/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/defects/" || r.URL.Path == "/api/defects" {
			defectsHandler(w, r)
			return
		}
		defectItemHandler(w, r)
	})
	mux.HandleFunc("/api/reports/summary", reportsSummaryHandler)
	mux.HandleFunc("/api/traceability", traceabilityHandler)
	mux.HandleFunc("/api/manual-runs", manualRunsHandler)

	log.Printf("turnobot-test-learn backend listening on :%s", port)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		mux.ServeHTTP(w, r)
	})
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatal(err)
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func runTestsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx := r.Context()
	projectID := os.Getenv("GCP_PROJECT_ID")
	if projectID == "" {
		projectID = "stalwart-coast-439901-d0"
	}

	cb, err := cloudbuild.NewService(ctx, option.WithScopes(cloudbuild.CloudPlatformScope))
	if err != nil {
		http.Error(w, "cloudbuild client error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	build := &cloudbuild.Build{
		Steps: []*cloudbuild.BuildStep{
			{Name: "gcr.io/cloud-builders/git", Args: []string{"clone", "https://github.com/amonroyf/turnobot.git", "."}},
			{
				Name:       "golang:1.26",
				Entrypoint: "bash",
				Args: []string{"-c", "apt-get update && apt-get install -y nodejs npm openjdk-21-jre-headless && npm i -g firebase-tools && firebase emulators:exec --only firestore,auth 'cd backend && FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 go test ./...'"},
			},
		},
	}

	op, err := cb.Projects.Builds.Create(projectID, build).Do()
	if err != nil {
		log.Printf("Error disparando Cloud Build: %v", err)
		http.Error(w, "error triggering build: "+err.Error(), http.StatusInternalServerError)
		return
	}

	buildID := op.Name
	var buildResp cloudbuild.Build
	if len(op.Response) > 0 {
		_ = json.Unmarshal(op.Response, &buildResp)
		if buildResp.Id != "" {
			buildID = buildResp.Id
		}
	}

	if fsClient != nil {
		_, _, _ = fsClient.Collection("test_runs").Add(ctx, map[string]interface{}{
			"test_name":  "suite",
			"status":     "running",
			"build_id":   buildID,
			"timestamp":  time.Now(),
			"duration_ms": 0,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "queued", "build_id": buildID})
}

func receiveReportHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var report map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&report); err != nil {
		http.Error(w, "invalid payload", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	docRef, _, err := fsClient.Collection("test_runs").Add(ctx, report)
	if err != nil {
		log.Printf("Error guardando el reporte en Firestore: %v", err)
		http.Error(w, "error saving to database", http.StatusInternalServerError)
		return
	}

	testName, _ := report["test_name"].(string)
	log.Printf("✅ REPORTE GUARDADO en Firestore: %s (ID: %s)", testName, docRef.ID)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "report_saved", "id": docRef.ID})
}
