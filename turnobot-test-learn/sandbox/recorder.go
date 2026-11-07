package sandbox

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
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
	Request       HTTPRequest            `json:"http_request"`
	Response      HTTPResponse           `json:"http_response"`
	DBBefore      map[string]interface{} `json:"db_before"`
	DBAfter       map[string]interface{} `json:"db_after"`
	DBDelta       map[string]interface{} `json:"db_delta"`
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

	rec := httptest.NewRecorder()
	handler(rec, req)

	after := Snapshot(ctx, client, collections, filterField, filterValue)

	var resBody map[string]interface{}
	_ = json.Unmarshal(rec.Body.Bytes(), &resBody)

	report := TestRun{
		TestName:   t.Name(),
		Timestamp:  start,
		DurationMs: time.Since(start).Milliseconds(),
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
		DBBefore: before,
		DBAfter:  after,
	}
	report.DBDelta = Delta(before, after)

	return report
}
