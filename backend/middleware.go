package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// CORS con dominios permitidos
// ---------------------------------------------------------------------------

var allowedOrigins = map[string]bool{
	"https://turnobot-web.web.app": true,
	"https://stalwart-coast-439901-d0.web.app": true,
	"http://localhost:5173": true,
	"http://localhost:3000": true,
}

func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if allowedOrigins[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}

		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Max-Age", "86400")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next(w, r)
	}
}

// ---------------------------------------------------------------------------
// Security Headers
// ---------------------------------------------------------------------------

func securityHeadersMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-XSS-Protection", "1; mode=block")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		// HSTS solo en HTTPS
		if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
			w.Header().Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
		}
		next(w, r)
	}
}

// ---------------------------------------------------------------------------
// Rate Limiting (por IP, en memoria)
// ---------------------------------------------------------------------------

type rateLimiter struct {
	mu       sync.Mutex
	visitors map[string]*visitor
	limit    int
	window   time.Duration
}

type visitor struct {
	tokens   int
	lastSeen time.Time
}

var (
	apiLimiter    = newRateLimiter(60, time.Minute)    // 60 req/min por IP
	bookingLimiter = newRateLimiter(10, time.Minute)   // 10 bookings/min por IP
)

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	rl := &rateLimiter{
		visitors: make(map[string]*visitor),
		limit:    limit,
		window:   window,
	}
	// Limpiar visitantes cada 5 minutos
	go func() {
		for range time.Tick(5 * time.Minute) {
			rl.cleanup()
		}
	}()
	return rl
}

func (rl *rateLimiter) cleanup() {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	for ip, v := range rl.visitors {
		if time.Since(v.lastSeen) > rl.window*2 {
			delete(rl.visitors, ip)
		}
	}
}

func (rl *rateLimiter) allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	v, exists := rl.visitors[ip]
	if !exists {
		rl.visitors[ip] = &visitor{tokens: rl.limit - 1, lastSeen: time.Now()}
		return true
	}

	// Renovar tokens según el tiempo transcurrido
	elapsed := time.Since(v.lastSeen)
	tokensToAdd := int(elapsed.Seconds() * float64(rl.limit) / rl.window.Seconds())
	if tokensToAdd > 0 {
		v.tokens += tokensToAdd
		if v.tokens > rl.limit {
			v.tokens = rl.limit
		}
	}
	v.lastSeen = time.Now()

	if v.tokens <= 0 {
		return false
	}
	v.tokens--
	return true
}

func rateLimitMiddleware(rl *rateLimiter, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			ip = strings.Split(fwd, ",")[0]
		}
		if fwd := r.Header.Get("X-Real-IP"); fwd != "" {
			ip = fwd
		}
		ip = strings.TrimSpace(ip)

		if !rl.allow(ip) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Retry-After", "60")
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"error":   "rate_limited",
				"message": "Demasiadas peticiones. Intenta de nuevo en un minuto.",
			})
			return
		}
		next(w, r)
	}
}

// ---------------------------------------------------------------------------
// Structured Logging
// ---------------------------------------------------------------------------

type structuredLogger struct{}

type logEntry struct {
	Timestamp string `json:"timestamp"`
	Level     string `json:"level"`
	Method    string `json:"method"`
	Path      string `json:"path"`
	Status    int    `json:"status,omitempty"`
	Duration  string `json:"duration,omitempty"`
	IP        string `json:"ip,omitempty"`
	Message   string `json:"message,omitempty"`
}

func (l structuredLogger) log(level, method, path, msg string, status int, duration time.Duration, ip string) {
	entry := logEntry{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Level:     level,
		Method:    method,
		Path:      path,
		Status:    status,
		Duration:  duration.String(),
		IP:        ip,
		Message:   msg,
	}
	data, _ := json.Marshal(entry)
	log.Println(string(data))
}

var logger = structuredLogger{}

func loggingMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ip := r.RemoteAddr
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			ip = strings.Split(fwd, ",")[0]
		}

		rw := &responseWriter{ResponseWriter: w, status: http.StatusOK}
		next(rw, r)

		duration := time.Since(start)
		level := "info"
		if rw.status >= 400 {
			level = "warn"
		}
		if rw.status >= 500 {
			level = "error"
		}
		logger.log(level, r.Method, r.URL.Path, "", rw.status, duration, strings.TrimSpace(ip))
	}
}

type responseWriter struct {
	http.ResponseWriter
	status int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

// ---------------------------------------------------------------------------
// Composite middleware: security → cors → rateLimit → logging → handler
// ---------------------------------------------------------------------------

func chainMiddleware(handler http.HandlerFunc, limiter *rateLimiter) http.HandlerFunc {
	return securityHeadersMiddleware(
		corsMiddleware(
			rateLimitMiddleware(limiter,
				loggingMiddleware(handler),
			),
		),
	)
}
