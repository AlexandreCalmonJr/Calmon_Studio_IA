package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// Config centraliza as variáveis de ambiente do Edge Gateway & Crawler em Go.
type Config struct {
	Port                 string
	UpstreamBrainURL     *url.URL
	PythonWorkerURL      *url.URL
	RateLimitRPS         float64
	InternalGatewayToken string
}

// Load lê e valida a configuração do ambiente no arranque do processo.
func Load() (*Config, error) {
	port := strings.TrimSpace(os.Getenv("GATEWAY_PORT"))
	if port == "" {
		port = "8080"
	}

	brainRaw := strings.TrimSpace(os.Getenv("UPSTREAM_BRAIN_URL"))
	if brainRaw == "" {
		brainRaw = "http://jarvis-brain-api:3000"
	}
	brainURL, err := url.Parse(brainRaw)
	if err != nil || brainURL.Host == "" {
		return nil, fmt.Errorf("UPSTREAM_BRAIN_URL inválida: %q", brainRaw)
	}

	pythonRaw := strings.TrimSpace(os.Getenv("PYTHON_WORKER_URL"))
	if pythonRaw == "" {
		pythonRaw = "http://jarvis-python-worker:8001"
	}
	pythonURL, err := url.Parse(pythonRaw)
	if err != nil || pythonURL.Host == "" {
		return nil, fmt.Errorf("PYTHON_WORKER_URL inválida: %q", pythonRaw)
	}

	rps := 40.0
	if rawRPS := strings.TrimSpace(os.Getenv("RATE_LIMIT_RPS")); rawRPS != "" {
		if parsed, parseErr := strconv.ParseFloat(rawRPS, 64); parseErr == nil && parsed >= 5 {
			rps = parsed
		}
	}

	return &Config{
		Port:                 port,
		UpstreamBrainURL:     brainURL,
		PythonWorkerURL:      pythonURL,
		RateLimitRPS:         rps,
		InternalGatewayToken: strings.TrimSpace(os.Getenv("INTERNAL_GATEWAY_TOKEN")),
	}, nil
}
