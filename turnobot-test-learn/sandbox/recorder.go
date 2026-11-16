package sandbox

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
)

// HTTPRequest representa la petición que llegó al handler.
type HTTPRequest struct {
	Method  string                 `json:"method"`
	URL     string                 `json:"url"`
	Headers map[string][]string    `json:"headers"`
	Body    map[string]interface{} `json:"body"`
}

// HTTPResponse representa la respuesta del handler.
type HTTPResponse struct {
	StatusCode int                    `json:"status_code"`
	Headers    map[string][]string    `json:"headers"`
	Body       map[string]interface{} `json:"body"`
}

// TestRun es el reporte completo de una ejecución interceptada.
type TestRun struct {
	TestName    string                 `json:"test_name"`
	Timestamp   time.Time              `json:"timestamp"`
	DurationMs  int64                  `json:"duration_ms"`
	Status      string                 `json:"status"`
	Environment string                 `json:"environment"`
	Request     HTTPRequest            `json:"http_request"`
	Response    HTTPResponse           `json:"response"`
	DBBefore    map[string]interface{} `json:"db_before"`
	DBAfter     map[string]interface{} `json:"db_after"`
	DBDelta     map[string]interface{} `json:"db_delta"`
	ConsoleLogs []string               `json:"console_logs"`
	// ReportPath es la ruta del JSON escrito en disco (vacío si no se pidió).
	ReportPath string `json:"report_path,omitempty"`
}

// Option configura el comportamiento del Intercept.
type Option func(*interceptConfig)

type interceptConfig struct {
	reportDir string
}

// WithReportDir hace que Intercept escriba el reporte del test como JSON en
// ese directorio. El nombre del archivo sale de t.Name() (sanitizado).
func WithReportDir(dir string) Option {
	return func(c *interceptConfig) { c.reportDir = dir }
}

// Intercept ejecuta un handler HTTP capturando request/response y snapshots
// de Firestore antes/después.
//
// La firma es retrocompatible: los tests existentes que la usan siguen
// compilando. Se le pueden pasar opciones con WithReportDir.
func Intercept(
	ctx context.Context,
	t interface {
		Helper()
		Name() string
	},
	handler http.HandlerFunc,
	req *http.Request,
	client *firestore.Client,
	collections []string,
	filterField string,
	filterValue interface{},
	opts ...Option,
) TestRun {
	t.Helper()
	cfg := &interceptConfig{}
	for _, o := range opts {
		o(cfg)
	}

	start := time.Now()

	var reqBody map[string]interface{}
	if req.Body != nil {
		reqBytes, _ := io.ReadAll(req.Body)
		_ = json.Unmarshal(reqBytes, &reqBody)
		req.Body = io.NopCloser(bytes.NewBuffer(reqBytes))
	}

	before := Snapshot(ctx, client, collections, filterField, filterValue)

	// Capturar salida de consola (stdout/stderr) durante el handler.
	// Guardamos el writer ORIGINAL del logger: restaurarlo a os.Stderr
	// (como hacía la versión anterior) pisaba cualquier destino previo.
	oldStdout, oldStderr := os.Stdout, os.Stderr
	oldLogWriter := log.Writer()
	r, w, _ := os.Pipe()
	os.Stdout, os.Stderr = w, w
	log.SetOutput(w)
	logBuf := make([]byte, 0, 4096)
	done := make(chan struct{})
	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := r.Read(buf)
			if n > 0 {
				logBuf = append(logBuf, buf[:n]...)
			}
			if err != nil {
				close(done)
				return
			}
		}
	}()

	rec := httptest.NewRecorder()
	handler(rec, req)

	w.Close()
	<-done
	os.Stdout, os.Stderr = oldStdout, oldStderr
	log.SetOutput(oldLogWriter)

	after := Snapshot(ctx, client, collections, filterField, filterValue)

	var resBody map[string]interface{}
	_ = json.Unmarshal(rec.Body.Bytes(), &resBody)

	status := "completed"

	environment := os.Getenv("TEST_ENV")
	if environment == "" {
		environment = "local"
	}
	if v, ok := resBody["success"].(bool); ok {
		if v {
			status = "pass"
		} else {
			status = "fail"
		}
	} else if rec.Code >= 400 {
		status = "fail"
	} else if rec.Code >= 200 && rec.Code < 300 {
		status = "pass"
	}

	report := TestRun{
		TestName:   t.Name(),
		Timestamp:  start,
		DurationMs: time.Since(start).Milliseconds(),
		Status:     status,
		Environment: environment,
		Request: HTTPRequest{
			Method:  req.Method,
			URL:     req.URL.String(),
			Headers: req.Header,
			Body:    reqBody,
		},
		Response: HTTPResponse{
			StatusCode: rec.Code,
			Headers:    rec.Header(),
			Body:       resBody,
		},
		DBBefore:    before,
		DBAfter:     after,
		ConsoleLogs: splitLines(string(logBuf)),
	}
	report.DBDelta = Delta(before, after)

	if cfg.reportDir != "" {
		path, err := writeReport(cfg.reportDir, report)
		if err == nil {
			report.ReportPath = path
		}
	}

	return report
}

// writeReport guarda el reporte como JSON y devuelve la ruta escrita.
//
// Un test puede llamar al handler varias veces (ej. un caso que espera 201 y
// otro que espera 400). Cada llamada es una ejecución distinta y merece su
// propio archivo: si el nombre ya existe, se agrega un sufijo numérico en
// vez de sobrescribir el reporte anterior.
func writeReport(dir string, report TestRun) (string, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	base := SanitizeFileName(report.TestName)
	path := filepath.Join(dir, base+".json")
	for i := 2; ; i++ {
		if _, err := os.Stat(path); os.IsNotExist(err) {
			break
		}
		path = filepath.Join(dir, fmt.Sprintf("%s_%d.json", base, i))
	}
	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", err
	}
	return path, nil
}

// SanitizeFileName convierte un nombre de test de Go en un nombre de archivo
// seguro. Los subtests de Go usan "/" en el nombre (TestX/sub) y el sistema
// de archivos no lo acepta en un archivo.
func SanitizeFileName(name string) string {
	r := strings.NewReplacer(
		"/", "__",
		"\\", "_",
		":", "_",
		"*", "_",
		"?", "_",
		"\"", "_",
		"<", "_",
		">", "_",
		"|", "_",
		" ", "_",
	)
	out := r.Replace(name)
	if out == "" {
		return "test"
	}
	return out
}

func splitLines(s string) []string {
	lines := []string{}
	for _, l := range strings.Split(s, "\n") {
		if strings.TrimSpace(l) != "" {
			lines = append(lines, l)
		}
	}
	return lines
}
