// JARVIS AI Hub — Serviço Go (Edge Gateway de Alta Concorrência + Crawler)
// Estrutura modular: internal/config, internal/middleware, internal/crawler, internal/proxy.
package main

import (
	"log"
	"net/http"
	"time"

	"jarvis-go-gateway/internal/config"
	"jarvis-go-gateway/internal/proxy"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("[JARVIS Go Gateway] erro de configuração: %v", err)
	}

	startedAt := time.Now()
	router := proxy.NewRouter(cfg, startedAt)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	log.Printf(
		"[JARVIS Go Gateway] ouvindo em :%s | brain=%s | python=%s | rps=%.0f",
		cfg.Port,
		cfg.UpstreamBrainURL.String(),
		cfg.PythonWorkerURL.String(),
		cfg.RateLimitRPS,
	)
	log.Fatal(srv.ListenAndServe())
}
