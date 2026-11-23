package middleware

import (
	"net"
	"net/http"
	"sync"
	"time"
)

type rateBucket struct {
	tokens float64
	last   time.Time
}

// IPLimiter implementa token bucket concorrente por IP cliente.
type IPLimiter struct {
	mu      sync.Mutex
	rps     float64
	burst   float64
	buckets map[string]*rateBucket
}

// NewIPLimiter cria um limitador com taxa mínima de 5 req/s.
func NewIPLimiter(rps float64) *IPLimiter {
	if rps < 5 {
		rps = 40
	}
	return &IPLimiter{
		rps:     rps,
		burst:   rps * 2,
		buckets: make(map[string]*rateBucket),
	}
}

// Allow retorna true se o IP ainda possui cota disponível.
func (l *IPLimiter) Allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	b, ok := l.buckets[ip]
	if !ok {
		l.buckets[ip] = &rateBucket{tokens: l.burst - 1, last: now}
		return true
	}
	elapsed := now.Sub(b.last).Seconds()
	b.tokens += elapsed * l.rps
	if b.tokens > l.burst {
		b.tokens = l.burst
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// Wrap aplica cabeçalhos de segurança e controle de taxa ao handler alvo.
func (l *IPLimiter) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")

		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil || host == "" {
			host = r.RemoteAddr
		}
		if !l.Allow(host) {
			http.Error(w, "Rate limit exceeded", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}
