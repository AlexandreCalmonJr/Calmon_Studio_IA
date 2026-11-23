package proxy

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httputil"
	"strings"
	"sync"
	"time"

	"jarvis-go-gateway/internal/config"
	"jarvis-go-gateway/internal/crawler"
	"jarvis-go-gateway/internal/middleware"
)

type crawlPayload struct {
	URLs []string `json:"urls"`
}

type upstreamCheck struct {
	Name       string `json:"name"`
	Target     string `json:"target"`
	Status     string `json:"status"`
	StatusCode int    `json:"status_code,omitempty"`
	LatencyMs  int64  `json:"latency_ms"`
	Error      string `json:"error,omitempty"`
}

func probeHTTP(ctx context.Context, name, target string) upstreamCheck {
	t0 := time.Now()
	client := &http.Client{Timeout: 3 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return upstreamCheck{Name: name, Target: target, Status: "offline", Error: err.Error(), LatencyMs: time.Since(t0).Milliseconds()}
	}
	resp, err := client.Do(req)
	if err != nil {
		return upstreamCheck{Name: name, Target: target, Status: "offline", Error: err.Error(), LatencyMs: time.Since(t0).Milliseconds()}
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))

	status := "online"
	if resp.StatusCode >= 400 {
		status = "degraded"
	}
	return upstreamCheck{
		Name:       name,
		Target:     target,
		Status:     status,
		StatusCode: resp.StatusCode,
		LatencyMs:  time.Since(t0).Milliseconds(),
	}
}

// NewRouter monta todas as rotas HTTP do Gateway: health checks, crawler concorrente e proxy reverso.
func NewRouter(cfg *config.Config, startedAt time.Time) http.Handler {
	brainProxy := httputil.NewSingleHostReverseProxy(cfg.UpstreamBrainURL)
	pythonProxy := httputil.NewSingleHostReverseProxy(cfg.PythonWorkerURL)
	limiter := middleware.NewIPLimiter(cfg.RateLimitRPS)

	mux := http.NewServeMux()

	healthHandler := func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":         "online",
			"service":        "jarvis-go-gateway",
			"brain_upstream": cfg.UpstreamBrainURL.String(),
			"python_worker":  cfg.PythonWorkerURL.String(),
			"uptime_seconds": int(time.Since(startedAt).Seconds()),
		})
	}

	mux.HandleFunc("GET /health", healthHandler)
	mux.HandleFunc("GET /gateway/health", healthHandler)

	// Health check concorrente da infraestrutura inteira (Node Brain + Python FastAPI Worker)
	mux.HandleFunc("GET /gateway/infra/health", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
		defer cancel()

		checks := make([]upstreamCheck, 2)
		var wg sync.WaitGroup
		wg.Add(2)

		go func() {
			defer wg.Done()
			checks[0] = probeHTTP(ctx, "jarvis-brain-api", strings.TrimRight(cfg.UpstreamBrainURL.String(), "/")+"/api/v1/brain/health")
		}()
		go func() {
			defer wg.Done()
			checks[1] = probeHTTP(ctx, "jarvis-python-worker", strings.TrimRight(cfg.PythonWorkerURL.String(), "/")+"/health")
		}()
		wg.Wait()

		overall := "online"
		for _, c := range checks {
			if c.Status != "online" {
				overall = "degraded"
			}
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":         overall,
			"service":        "jarvis-go-gateway",
			"uptime_seconds": int(time.Since(startedAt).Seconds()),
			"upstreams":      checks,
		})
	})

	// Crawler concorrente protegido por token interno opcional
	mux.HandleFunc("POST /gateway/crawl", func(w http.ResponseWriter, r *http.Request) {
		if cfg.InternalGatewayToken != "" {
			got := r.Header.Get("X-Gateway-Token")
			if subtle.ConstantTimeCompare([]byte(got), []byte(cfg.InternalGatewayToken)) != 1 {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}
		}

		var req crawlPayload
		if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&req); err != nil {
			http.Error(w, "JSON inválido", http.StatusBadRequest)
			return
		}

		results := crawler.CrawlBatch(r.Context(), req.URLs)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"results": results})
	})

	// Proxy dedicado para o Worker Python FastAPI (/rag/*)
	mux.Handle("/rag/", limiter.Wrap(pythonProxy))

	// Proxy reverso principal para o Cérebro Node.js (/api/v1/* e frontend)
	mux.Handle("/", limiter.Wrap(brainProxy))

	return mux
}
