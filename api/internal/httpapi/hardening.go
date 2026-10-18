package httpapi

import (
	"bytes"
	"net/http"
	"strings"
	"sync"
	"time"
)

// securityHeaders: the API only ever returns JSON, images or event streams.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Cross-Origin-Resource-Policy", "same-origin")
		h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}

// limiter is a fixed-window request counter per key (session or IP).
// In-memory: per instance, which is fine as a first line; the OTP limits that
// matter most live in Postgres.
type limiter struct {
	mu     sync.Mutex
	window time.Duration
	max    int
	hits   map[string]*bucket
	sweep  time.Time
}

type bucket struct {
	start time.Time
	n     int
}

func newLimiter(max int, window time.Duration) *limiter {
	return &limiter{window: window, max: max, hits: map[string]*bucket{}}
}

func (l *limiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if now.Sub(l.sweep) > l.window {
		for k, b := range l.hits {
			if now.Sub(b.start) > l.window {
				delete(l.hits, k)
			}
		}
		l.sweep = now
	}
	b := l.hits[key]
	if b == nil || now.Sub(b.start) > l.window {
		l.hits[key] = &bucket{start: now, n: 1}
		return true
	}
	b.n++
	return b.n <= l.max
}

// rateLimit caps requests per session cookie (or IP when signed out). Writes get
// a tighter budget than reads. The live stream and photo reads are exempt.
func (s *Server) rateLimit(next http.Handler) http.Handler {
	reads := newLimiter(600, time.Minute)
	writes := newLimiter(120, time.Minute)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/live" || strings.HasPrefix(r.URL.Path, "/api/v1/media/") || strings.HasSuffix(r.URL.Path, "/stream") || r.URL.Path == "/healthz" {
			next.ServeHTTP(w, r)
			return
		}
		key := ""
		if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
			key = "s:" + c.Value
		} else if ip := s.clientIP(r); ip != nil {
			key = "ip:" + ip.String()
		}
		l := reads
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			l = writes
		}
		if key != "" && !l.allow(key, time.Now()) {
			w.Header().Set("Retry-After", "60")
			writeError(w, http.StatusTooManyRequests, "rate_limited", "That’s a lot at once. Try again in a minute.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// idempotency replays the response to a retried POST that carries the same
// Idempotency-Key (the offline outbox sends one), so a save sent twice after a
// dropped connection doesn't create two pins or notes. Successful responses
// only, kept for 24 hours, per session.
type idemEntry struct {
	at     time.Time
	status int
	body   []byte
}

type idemCache struct {
	mu sync.Mutex
	m  map[string]idemEntry
}

type recorder struct {
	http.ResponseWriter
	status int
	buf    bytes.Buffer
}

func (r *recorder) WriteHeader(code int) { r.status = code; r.ResponseWriter.WriteHeader(code) }
func (r *recorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	r.buf.Write(b)
	return r.ResponseWriter.Write(b)
}

func (s *Server) idempotency(next http.Handler) http.Handler {
	cache := &idemCache{m: map[string]idemEntry{}}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("Idempotency-Key")
		c, err := r.Cookie(sessionCookie)
		if r.Method != http.MethodPost || key == "" || len(key) > 100 || err != nil {
			next.ServeHTTP(w, r)
			return
		}
		full := c.Value + "|" + r.URL.Path + "|" + key
		now := time.Now()
		cache.mu.Lock()
		if e, ok := cache.m[full]; ok && now.Sub(e.at) < 24*time.Hour {
			cache.mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Idempotent-Replayed", "true")
			w.WriteHeader(e.status)
			_, _ = w.Write(e.body)
			return
		}
		if len(cache.m) > 20000 {
			for k, e := range cache.m {
				if now.Sub(e.at) > 24*time.Hour {
					delete(cache.m, k)
				}
			}
		}
		cache.mu.Unlock()
		rec := &recorder{ResponseWriter: w}
		next.ServeHTTP(rec, r)
		if rec.status >= 200 && rec.status < 300 {
			cache.mu.Lock()
			cache.m[full] = idemEntry{at: now, status: rec.status, body: rec.buf.Bytes()}
			cache.mu.Unlock()
		}
	})
}
