package sandbox

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
)

type HTTPRequest struct {
	Method  string                 `json:"method"`
	URL     string                 `json:"url"`
	Headers map[string][]string    `json:"headers"`
	Body    map[string]interface{} `json:"body"`
}

type HTTPResponse struct {
	StatusCode int                    `json:"status_code"`
	Headers    map[string][]string    `json:"headers"`
	Body       map[string]interface{} `json:"body"`
}

type TestRun struct {
	TestName      string                 `json:"test_name"`
	Timestamp     time.Time              `json:"timestamp"`
	DurationMs    int64                  `json:"duration_ms"`
	Status        string                 `json:"status"`
	Environment   string                 `json:"environment"`
	Request       HTTPRequest            `json:"http_request"`
	Response      HTTPResponse           `json:"http_response"`
	DBBefore      map[string]interface{} `json:"db_before"`
	DBAfter       map[string]interface{} `json:"db_after"`
	DBDelta       map[string]interface{} `json:"db_delta"`
	ConsoleLogs   []string               `json:"console_logs"`
}

// Intercept ejecuta un handler HTTP capturando request/response y snapshots de Firestore.
func Intercept(ctx context.Context, t interface{ Helper(); Name() string }, handler http.HandlerFunc, req *http.Request, client *firestore.Client, collections []string, filterField string, filterValue interface{}) TestRun {
	t.Helper()
	start := time.Now()

	var reqBody map[string]interface{}
	if req.Body != nil {
		reqBytes, _ := io.ReadAll(req.Body)
		_ = json.Unmarshal(reqBytes, &reqBody)
		req.Body = io.NopCloser(bytes.NewBuffer(reqBytes))
	}

	before := Snapshot(ctx, client, collections, filterField, filterValue)

	// Capturar salida de consola (stdout/stderr) durante el handler.
	oldStdout, oldStderr := os.Stdout, os.Stderr
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
	log.SetOutput(oldStderr)

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
		DurationMs:  time.Since(start).Milliseconds(),
		Status:      status,
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

	return report
}

func splitLines(s string) []string {
	lines := []string{}
	for _, l := range strings.Split(s, "\n") {
		if strings.TrimSpace(l) != "" {
			lines = append(lines, l)
		}
	}
	if len(lines) == 0 {
		return []string{}
	}
	return lines
}
