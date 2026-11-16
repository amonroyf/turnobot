package main

// Harness de pruebas: intercepta los handlers HTTP y graba el estado de
// Firestore antes/después de cada llamada.
//
// Por qué existe: un test que solo mira el status code no dice si el handler
// escribió lo que debía. Con el delta de Firestore se ve exactamente qué
// documentos se crearon, modificaron o borraron.
//
// Uso típico en un test:
//
//	slug := slugUnico("test-book")
//	seedTienda(t, ctx, slug)
//	code, out := postBook(t, slug, map[string]string{...})
//
// `postBook` ya pasa por el Intercept, así que no hay que hacer nada extra.
// Los reportes se escriben en backend/test-reports/<nombre-del-test>.json.
//
// Para desactivar los reportes: QA_TEST_REPORTS=0.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"turnobot-test-learn/sandbox"
)

// reportDirQA es la carpeta donde se escriben los reportes JSON.
const reportDirQA = "test-reports"

// reportDirQAResuelto devuelve la ruta (absoluta) del directorio de reportes
// o "" si están deshabilitados con QA_TEST_REPORTS=0.
func reportDirQAResuelto(t *testing.T) string {
	t.Helper()
	if os.Getenv("QA_TEST_REPORTS") == "0" {
		return ""
	}
	dir := os.Getenv("QA_TEST_REPORT_DIR")
	if dir == "" {
		dir = reportDirQA
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		t.Fatalf("ruta de reportes inválida %q: %v", dir, err)
	}
	return abs
}

// coleccionesQA son las colecciones que el harness captura para un negocio.
//
// Las dos primeras son colecciones de raíz y se filtran por negocio_id.
// Las siguientes son subcolecciones de negocios/{slug}: ya están acotadas por
// el documento padre, así que no llevan filtro.
func coleccionesQA(slug string) []string {
	return []string{
		"reservas",
		"clientes",
		"negocios/" + slug + "/recursos",
		"negocios/" + slug + "/empleados",
		"negocios/" + slug + "/servicios",
	}
}

// interceptar ejecuta handler bajo el harness: mide request/response, toma
// snapshots de Firestore antes y después, calcula el delta y deja el reporte
// en disco.
//
// Devuelve el reporte completo. Para el contrato simple (status + body) se
// usan report.Response.StatusCode y report.Response.Body.
func interceptar(
	t *testing.T,
	slug string,
	handler http.HandlerFunc,
	req *http.Request,
) sandbox.TestRun {
	t.Helper()
	ctx := context.Background()

	var opts []sandbox.Option
	if dir := reportDirQAResuelto(t); dir != "" {
		opts = append(opts, sandbox.WithReportDir(dir))
	}

	report := sandbox.Intercept(
		ctx, t, handler, req, firestoreClient,
		coleccionesQA(slug), "negocio_id", slug,
		opts...,
	)
	return report
}

// interceptarCodigo es la forma corta: devuelve status y body parseado,
// igual que los helpers que existían antes del harness.
func interceptarCodigo(
	t *testing.T,
	slug string,
	handler http.HandlerFunc,
	req *http.Request,
) (int, map[string]interface{}) {
	t.Helper()
	report := interceptar(t, slug, handler, req)
	return report.Response.StatusCode, report.Response.Body
}

// resumirDelta devuelve una línea con el resumen del delta, para logs
// legibles durante la corrida (ej. "reservas: +1, clientes: +1").
func resumirDelta(delta map[string]interface{}) string {
	if len(delta) == 0 {
		return "sin cambios"
	}
	out := ""
	for _, coll := range []string{"reservas", "clientes"} {
		docs, ok := delta[coll].(map[string]interface{})
		if !ok || len(docs) == 0 {
			continue
		}
		if out != "" {
			out += ", "
		}
		out += fmt.Sprintf("%s: %d", coll, len(docs))
	}
	if out == "" {
		return "sin cambios en reservas/clientes"
	}
	return out
}

// jsonDeReporte serializa un reporte a JSON legible (para logs de test).
func jsonDeReporte(v interface{}) string {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return "{}"
	}
	return string(b)
}

// despacharReporteTMS envía el reporte al TMS (backend de gestión de pruebas).
//
// Es opcional: sin TMS_BACKEND_URL no se envía nada. Antes el default era
// http://localhost:8080/api/reports, pero el 8080 lo ocupa el backend de
// Turnobot: el POST caía en el servicio equivocado y se perdía en un 404
// silencioso (la respuesta no se revisaba).
//
// El puerto por defecto del TMS es 8091 para no chocar con el backend.
func despacharReporteTMS(t *testing.T, report sandbox.TestRun) {
	t.Helper()
	base := os.Getenv("TMS_BACKEND_URL")
	if base == "" {
		base = "http://localhost:8091"
	}
	url := base + "/api/reports"

	data, err := json.Marshal(report)
	if err != nil {
		t.Logf("harness: no se pudo serializar el reporte: %v", err)
		return
	}
	go func() {
		client := &http.Client{Timeout: 3 * time.Second}
		resp, err := client.Post(url, "application/json", bytes.NewBuffer(data))
		if err != nil {
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 400 {
			return
		}
	}()
}
