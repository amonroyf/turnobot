package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
)

type TestStep struct {
	Order    int    `json:"order" firestore:"order"`
	Action   string `json:"action" firestore:"action"`
	Expected string `json:"expected" firestore:"expected"`
}

type Requirement struct {
	ID          string    `json:"id,omitempty" firestore:"-"`
	Title       string    `json:"title" firestore:"title"`
	Description string    `json:"description" firestore:"description"`
	Status      string    `json:"status" firestore:"status"`
	Owner       string    `json:"owner" firestore:"owner"`
	CreatedAt   time.Time `json:"created_at" firestore:"created_at"`
}

type TestCase struct {
	ID             string     `json:"id,omitempty" firestore:"-"`
	Title          string     `json:"title" firestore:"title"`
	Description    string     `json:"description" firestore:"description"`
	Type           string     `json:"type" firestore:"type"`
	Priority       string     `json:"priority" firestore:"priority"`
	Steps          []TestStep `json:"steps" firestore:"steps"`
	RequirementIDs []string   `json:"requirement_ids" firestore:"requirement_ids"`
	SuiteIDs       []string   `json:"suite_ids" firestore:"suite_ids"`
	Tags           []string   `json:"tags" firestore:"tags"`
	Version        int        `json:"version" firestore:"version"`
	CreatedAt      time.Time  `json:"created_at" firestore:"created_at"`
}

type TestSuite struct {
	ID          string                 `json:"id,omitempty" firestore:"-"`
	Name        string                 `json:"name" firestore:"name"`
	Description string                 `json:"description" firestore:"description"`
	CaseIDs     []string               `json:"case_ids" firestore:"case_ids"`
	Params      map[string]interface{} `json:"params" firestore:"params"`
	ParentID    string                 `json:"parent_id" firestore:"parent_id"`
	CreatedAt   time.Time              `json:"created_at" firestore:"created_at"`
}

type Defect struct {
	ID             string    `json:"id,omitempty" firestore:"-"`
	Title          string    `json:"title" firestore:"title"`
	Description    string    `json:"description" firestore:"description"`
	Severity       string    `json:"severity" firestore:"severity"`
	Status         string    `json:"status" firestore:"status"`
	CaseIDs        []string  `json:"case_ids" firestore:"case_ids"`
	RequirementIDs []string  `json:"requirement_ids" firestore:"requirement_ids"`
	CreatedAt      time.Time `json:"created_at" firestore:"created_at"`
}

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func readBody(r *http.Request, v interface{}) error {
	return json.NewDecoder(r.Body).Decode(v)
}

func pathID(path, prefix string) string {
	p := strings.TrimPrefix(path, prefix)
	p = strings.Trim(p, "/")
	// remove trailing segments
	if idx := strings.Index(p, "/"); idx >= 0 {
		p = p[:idx]
	}
	return p
}

// ---------- Requirements ----------

func requirementsHandler(w http.ResponseWriter, r *http.Request) {
	if fsClient == nil {
		http.Error(w, "no firestore", http.StatusInternalServerError)
		return
	}
	switch r.Method {
	case http.MethodGet:
		iter := fsClient.Collection("requirements").OrderBy("created_at", firestore.Desc).Documents(r.Context())
		var out []Requirement
		for {
			doc, err := iter.Next()
			if err == iterator.Done {
				break
			}
			if err != nil {
				log.Printf("requirements list err: %v", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			var req Requirement
			if err := doc.DataTo(&req); err != nil {
				continue
			}
			req.ID = doc.Ref.ID
			out = append(out, req)
		}
		iter.Stop()
		if out == nil {
			out = []Requirement{}
		}
		writeJSON(w, http.StatusOK, out)
	case http.MethodPost:
		var req Requirement
		if err := readBody(r, &req); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		if req.Status == "" {
			req.Status = "draft"
		}
		req.CreatedAt = time.Now()
		ref, _, err := fsClient.Collection("requirements").Add(r.Context(), req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		req.ID = ref.ID
		writeJSON(w, http.StatusCreated, req)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func requirementItemHandler(w http.ResponseWriter, r *http.Request) {
	if fsClient == nil {
		http.Error(w, "no firestore", http.StatusInternalServerError)
		return
	}
	id := pathID(r.URL.Path, "/api/requirements/")
	if id == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}
	ref := fsClient.Collection("requirements").Doc(id)
	switch r.Method {
	case http.MethodGet:
		doc, err := ref.Get(r.Context())
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		var req Requirement
		_ = doc.DataTo(&req)
		req.ID = doc.Ref.ID
		writeJSON(w, http.StatusOK, req)
	case http.MethodPut:
		var req Requirement
		if err := readBody(r, &req); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		_, err := ref.Set(r.Context(), req, firestore.MergeAll)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		req.ID = id
		writeJSON(w, http.StatusOK, req)
	case http.MethodDelete:
		if _, err := ref.Delete(r.Context()); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// ---------- Test Cases ----------

func testCasesHandler(w http.ResponseWriter, r *http.Request) {
	if fsClient == nil {
		http.Error(w, "no firestore", http.StatusInternalServerError)
		return
	}
	switch r.Method {
	case http.MethodGet:
		iter := fsClient.Collection("test_cases").OrderBy("created_at", firestore.Desc).Documents(r.Context())
		var out []TestCase
		for {
			doc, err := iter.Next()
			if err == iterator.Done {
				break
			}
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			var tc TestCase
			if err := doc.DataTo(&tc); err != nil {
				continue
			}
			tc.ID = doc.Ref.ID
			out = append(out, tc)
		}
		iter.Stop()
		if out == nil {
			out = []TestCase{}
		}
		writeJSON(w, http.StatusOK, out)
	case http.MethodPost:
		var tc TestCase
		if err := readBody(r, &tc); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		if tc.Type == "" {
			tc.Type = "manual"
		}
		if tc.Priority == "" {
			tc.Priority = "medium"
		}
		if tc.Version == 0 {
			tc.Version = 1
		}
		tc.CreatedAt = time.Now()
		ref, _, err := fsClient.Collection("test_cases").Add(r.Context(), tc)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		tc.ID = ref.ID
		writeJSON(w, http.StatusCreated, tc)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func testCaseItemHandler(w http.ResponseWriter, r *http.Request) {
	if fsClient == nil {
		http.Error(w, "no firestore", http.StatusInternalServerError)
		return
	}
	id := pathID(r.URL.Path, "/api/test-cases/")
	if id == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}
	ref := fsClient.Collection("test_cases").Doc(id)
	switch r.Method {
	case http.MethodGet:
		doc, err := ref.Get(r.Context())
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		var tc TestCase
		_ = doc.DataTo(&tc)
		tc.ID = doc.Ref.ID
		writeJSON(w, http.StatusOK, tc)
	case http.MethodPut:
		var tc TestCase
		if err := readBody(r, &tc); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		_, err := ref.Set(r.Context(), tc, firestore.MergeAll)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		tc.ID = id
		writeJSON(w, http.StatusOK, tc)
	case http.MethodDelete:
		if _, err := ref.Delete(r.Context()); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// execute a manual test case and record a run
func executeTestCaseHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if fsClient == nil {
		http.Error(w, "no firestore", http.StatusInternalServerError)
		return
	}
	// path: /api/test-cases/{id}/execute
	p := strings.TrimPrefix(r.URL.Path, "/api/test-cases/")
	p = strings.Trim(p, "/")
	parts := strings.Split(p, "/")
	if len(parts) < 2 || parts[1] != "execute" {
		http.Error(w, "bad path", http.StatusBadRequest)
		return
	}
	caseID := parts[0]

	var payload struct {
		ExecutedBy    string                 `json:"executed_by"`
		Environment   string                 `json:"environment"`
		StepResults   []map[string]interface{} `json:"step_results"`
		Status        string                 `json:"status"`
		DurationMs    int64                  `json:"duration_ms"`
	}
	if err := readBody(r, &payload); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if payload.Status == "" {
		// derive
		allPass := true
		for _, sr := range payload.StepResults {
			if st, _ := sr["status"].(string); st != "pass" {
				allPass = false
			}
		}
		if allPass && len(payload.StepResults) > 0 {
			payload.Status = "pass"
		} else if len(payload.StepResults) > 0 {
			payload.Status = "fail"
		} else {
			payload.Status = "completed"
		}
	}
	if payload.Environment == "" {
		payload.Environment = "manual"
	}

	// fetch case title
	doc, _ := fsClient.Collection("test_cases").Doc(caseID).Get(r.Context())
	testName := caseID
	if doc != nil {
		var tc TestCase
		_ = doc.DataTo(&tc)
		if tc.Title != "" {
			testName = tc.Title
		}
	}

	run := map[string]interface{}{
		"test_name":     testName,
		"test_case_id":  caseID,
		"status":        payload.Status,
		"environment":   payload.Environment,
		"executed_by":   payload.ExecutedBy,
		"step_results":  payload.StepResults,
		"duration_ms":   payload.DurationMs,
		"timestamp":     time.Now(),
		"type":          "manual",
	}
	ref, _, err := fsClient.Collection("test_runs").Add(r.Context(), run)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	run["id"] = ref.ID
	writeJSON(w, http.StatusCreated, run)
}

// ---------- Test Suites ----------

func testSuitesHandler(w http.ResponseWriter, r *http.Request) {
	if fsClient == nil {
		http.Error(w, "no firestore", http.StatusInternalServerError)
		return
	}
	switch r.Method {
	case http.MethodGet:
		iter := fsClient.Collection("test_suites").OrderBy("created_at", firestore.Desc).Documents(r.Context())
		var out []TestSuite
		for {
			doc, err := iter.Next()
			if err == iterator.Done {
				break
			}
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			var ts TestSuite
			if err := doc.DataTo(&ts); err != nil {
				continue
			}
			ts.ID = doc.Ref.ID
			out = append(out, ts)
		}
		iter.Stop()
		if out == nil {
			out = []TestSuite{}
		}
		writeJSON(w, http.StatusOK, out)
	case http.MethodPost:
		var ts TestSuite
		if err := readBody(r, &ts); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		if ts.CaseIDs == nil {
			ts.CaseIDs = []string{}
		}
		if ts.Params == nil {
			ts.Params = map[string]interface{}{}
		}
		ts.CreatedAt = time.Now()
		ref, _, err := fsClient.Collection("test_suites").Add(r.Context(), ts)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		ts.ID = ref.ID
		writeJSON(w, http.StatusCreated, ts)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func testSuiteItemHandler(w http.ResponseWriter, r *http.Request) {
	if fsClient == nil {
		http.Error(w, "no firestore", http.StatusInternalServerError)
		return
	}
	// handle fork subpath
	p := strings.TrimPrefix(r.URL.Path, "/api/test-suites/")
	p = strings.Trim(p, "/")
	parts := strings.Split(p, "/")
	id := parts[0]
	if id == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}
	if len(parts) >= 2 && parts[1] == "fork" {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		doc, err := fsClient.Collection("test_suites").Doc(id).Get(r.Context())
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		var ts TestSuite
		_ = doc.DataTo(&ts)
		ts.ID = ""
		ts.ParentID = id
		ts.Name = ts.Name + " (fork)"
		ts.CreatedAt = time.Now()
		ref, _, err := fsClient.Collection("test_suites").Add(r.Context(), ts)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		ts.ID = ref.ID
		writeJSON(w, http.StatusCreated, ts)
		return
	}

	ref := fsClient.Collection("test_suites").Doc(id)
	switch r.Method {
	case http.MethodGet:
		doc, err := ref.Get(r.Context())
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		var ts TestSuite
		_ = doc.DataTo(&ts)
		ts.ID = doc.Ref.ID
		writeJSON(w, http.StatusOK, ts)
	case http.MethodPut:
		var ts TestSuite
		if err := readBody(r, &ts); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		_, err := ref.Set(r.Context(), ts, firestore.MergeAll)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		ts.ID = id
		writeJSON(w, http.StatusOK, ts)
	case http.MethodDelete:
		if _, err := ref.Delete(r.Context()); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// ---------- Defects ----------

func defectsHandler(w http.ResponseWriter, r *http.Request) {
	if fsClient == nil {
		http.Error(w, "no firestore", http.StatusInternalServerError)
		return
	}
	switch r.Method {
	case http.MethodGet:
		iter := fsClient.Collection("defects").OrderBy("created_at", firestore.Desc).Documents(r.Context())
		var out []Defect
		for {
			doc, err := iter.Next()
			if err == iterator.Done {
				break
			}
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			var d Defect
			if err := doc.DataTo(&d); err != nil {
				continue
			}
			d.ID = doc.Ref.ID
			out = append(out, d)
		}
		iter.Stop()
		if out == nil {
			out = []Defect{}
		}
		writeJSON(w, http.StatusOK, out)
	case http.MethodPost:
		var d Defect
		if err := readBody(r, &d); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		if d.Status == "" {
			d.Status = "open"
		}
		if d.Severity == "" {
			d.Severity = "medium"
		}
		if d.CaseIDs == nil {
			d.CaseIDs = []string{}
		}
		if d.RequirementIDs == nil {
			d.RequirementIDs = []string{}
		}
		d.CreatedAt = time.Now()
		ref, _, err := fsClient.Collection("defects").Add(r.Context(), d)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		d.ID = ref.ID
		writeJSON(w, http.StatusCreated, d)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func defectItemHandler(w http.ResponseWriter, r *http.Request) {
	if fsClient == nil {
		http.Error(w, "no firestore", http.StatusInternalServerError)
		return
	}
	id := pathID(r.URL.Path, "/api/defects/")
	if id == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}
	ref := fsClient.Collection("defects").Doc(id)
	switch r.Method {
	case http.MethodGet:
		doc, err := ref.Get(r.Context())
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		var d Defect
		_ = doc.DataTo(&d)
		d.ID = doc.Ref.ID
		writeJSON(w, http.StatusOK, d)
	case http.MethodPut:
		var d Defect
		if err := readBody(r, &d); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		_, err := ref.Set(r.Context(), d, firestore.MergeAll)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		d.ID = id
		writeJSON(w, http.StatusOK, d)
	case http.MethodDelete:
		if _, err := ref.Delete(r.Context()); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// ---------- Reports ----------

func reportsSummaryHandler(w http.ResponseWriter, r *http.Request) {
	if fsClient == nil {
		http.Error(w, "no firestore", http.StatusInternalServerError)
		return
	}
	ctx := r.Context()
	count := func(coll string) int {
		iter := fsClient.Collection(coll).Documents(ctx)
		n := 0
		for {
			_, err := iter.Next()
			if err == iterator.Done {
				break
			}
			if err != nil {
				break
			}
			n++
		}
		iter.Stop()
		return n
	}
	totalCases := count("test_cases")
	totalSuites := count("test_suites")
	totalReqs := count("requirements")
	totalDefects := count("defects")

	// runs
	iter := fsClient.Collection("test_runs").OrderBy("timestamp", firestore.Desc).Limit(100).Documents(ctx)
	totalRuns, pass, fail := 0, 0, 0
	var recent []map[string]interface{}
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			break
		}
		totalRuns++
		data := doc.Data()
		status, _ := data["status"].(string)
		if status == "pass" {
			pass++
		} else if status == "fail" {
			fail++
		}
		if len(recent) < 10 {
			data["id"] = doc.Ref.ID
			recent = append(recent, data)
		}
	}
	iter.Stop()

	// coverage: cases with at least one run
	caseSet := map[string]bool{}
	iter2 := fsClient.Collection("test_runs").Documents(ctx)
	for {
		doc, err := iter2.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			break
		}
		data := doc.Data()
		if id, ok := data["test_case_id"].(string); ok && id != "" {
			caseSet[id] = true
		}
	}
	iter2.Stop()
	covered := len(caseSet)
	coverage := 0.0
	if totalCases > 0 {
		coverage = float64(covered) / float64(totalCases) * 100
	}

	// defects by status
	openDefects := 0
	iter3 := fsClient.Collection("defects").Documents(ctx)
	for {
		doc, err := iter3.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			break
		}
		data := doc.Data()
		if st, _ := data["status"].(string); st == "open" {
			openDefects++
		}
	}
	iter3.Stop()

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"total_cases":     totalCases,
		"total_suites":    totalSuites,
		"total_requirements": totalReqs,
		"total_defects":   totalDefects,
		"open_defects":    openDefects,
		"total_runs":      totalRuns,
		"passed_runs":     pass,
		"failed_runs":     fail,
		"coverage_percent": coverage,
		"covered_cases":   covered,
		"recent_runs":     recent,
	})
}

// ---------- Traceability ----------

func traceabilityHandler(w http.ResponseWriter, r *http.Request) {
	if fsClient == nil {
		http.Error(w, "no firestore", http.StatusInternalServerError)
		return
	}
	ctx := r.Context()
	// requirements
	reqIter := fsClient.Collection("requirements").Documents(ctx)
	var reqs []Requirement
	for {
		doc, err := reqIter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			break
		}
		var rq Requirement
		_ = doc.DataTo(&rq)
		rq.ID = doc.Ref.ID
		reqs = append(reqs, rq)
	}
	reqIter.Stop()

	// cases
	caseIter := fsClient.Collection("test_cases").Documents(ctx)
	var cases []TestCase
	for {
		doc, err := caseIter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			break
		}
		var tc TestCase
		_ = doc.DataTo(&tc)
		tc.ID = doc.Ref.ID
		cases = append(cases, tc)
	}
	caseIter.Stop()

	// defects
	defIter := fsClient.Collection("defects").Documents(ctx)
	var defects []Defect
	for {
		doc, err := defIter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			break
		}
		var d Defect
		_ = doc.DataTo(&d)
		d.ID = doc.Ref.ID
		defects = append(defects, d)
	}
	defIter.Stop()

	// build matrix: requirement -> cases -> defects
	type TraceRow struct {
		Requirement Requirement  `json:"requirement"`
		Cases       []TestCase   `json:"cases"`
		Defects     []Defect     `json:"defects"`
	}
	var rows []TraceRow
	for _, rq := range reqs {
		row := TraceRow{Requirement: rq, Cases: []TestCase{}, Defects: []Defect{}}
		for _, tc := range cases {
			for _, rid := range tc.RequirementIDs {
				if rid == rq.ID {
					row.Cases = append(row.Cases, tc)
				}
			}
		}
		for _, d := range defects {
			for _, rid := range d.RequirementIDs {
				if rid == rq.ID {
					row.Defects = append(row.Defects, d)
				}
			}
		}
		rows = append(rows, row)
	}
	// orphan cases (no requirement)
	// include summary counts
	sort.Slice(rows, func(i, j int) bool { return rows[i].Requirement.Title < rows[j].Requirement.Title })

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"requirements": reqs,
		"test_cases":   cases,
		"defects":      defects,
		"matrix":       rows,
	})
}

// ---------- Manual runs list (filtered) ----------
func manualRunsHandler(w http.ResponseWriter, r *http.Request) {
	if fsClient == nil {
		http.Error(w, "no firestore", http.StatusInternalServerError)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	iter := fsClient.Collection("test_runs").OrderBy("timestamp", firestore.Desc).Limit(100).Documents(r.Context())
	var out []map[string]interface{}
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			break
		}
		data := doc.Data()
		data["id"] = doc.Ref.ID
		out = append(out, data)
	}
	iter.Stop()
	if out == nil {
		out = []map[string]interface{}{}
	}
	writeJSON(w, http.StatusOK, out)
}

var _ = fmt.Sprintf
