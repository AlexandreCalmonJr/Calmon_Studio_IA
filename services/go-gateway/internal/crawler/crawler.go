package crawler

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Result representa a resposta de uma URL processada pelo crawler concorrente.
type Result struct {
	URL        string `json:"url"`
	StatusCode int    `json:"status_code"`
	Bytes      int    `json:"bytes"`
	DurationMs int64  `json:"duration_ms"`
	Error      string `json:"error,omitempty"`
}

// ValidatePublicHTTPS garante que o alvo seja exclusivamente HTTPS público (bloqueando redes privadas e metadata).
func ValidatePublicHTTPS(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, fmt.Errorf("URL inválida")
	}
	if u.Scheme != "https" {
		return nil, fmt.Errorf("crawler permite apenas URLs públicas HTTPS")
	}
	host := strings.ToLower(u.Hostname())
	if host == "" || host == "localhost" || strings.HasSuffix(host, ".local") || host == "metadata.google.internal" {
		return nil, fmt.Errorf("host privado ou reservado bloqueado")
	}
	ips, err := net.LookupIP(host)
	if err != nil {
		return nil, fmt.Errorf("falha ao resolver DNS do alvo")
	}
	for _, ip := range ips {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return nil, fmt.Errorf("endereço IP interno bloqueado")
		}
	}
	return u, nil
}

// CrawlBatch processa até 8 URLs concorrentemente usando goroutines com timeout rígido.
func CrawlBatch(parentCtx context.Context, urls []string) []Result {
	if len(urls) > 8 {
		urls = urls[:8]
	}

	client := &http.Client{
		Timeout: 6 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return fmt.Errorf("limite de redirecionamentos excedido")
			}
			_, err := ValidatePublicHTTPS(req.URL.String())
			return err
		},
	}

	results := make([]Result, len(urls))
	var wg sync.WaitGroup

	for idx, rawURL := range urls {
		wg.Add(1)
		go func(i int, target string) {
			defer wg.Done()
			t0 := time.Now()

			parsed, vErr := ValidatePublicHTTPS(target)
			if vErr != nil {
				results[i] = Result{URL: target, Error: vErr.Error(), DurationMs: time.Since(t0).Milliseconds()}
				return
			}

			ctx, cancel := context.WithTimeout(parentCtx, 5*time.Second)
			defer cancel()

			req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
			if reqErr != nil {
				results[i] = Result{URL: target, Error: reqErr.Error(), DurationMs: time.Since(t0).Milliseconds()}
				return
			}
			req.Header.Set("User-Agent", "JARVIS-Go-Crawler/2.0")

			resp, doErr := client.Do(req)
			if doErr != nil {
				results[i] = Result{URL: target, Error: doErr.Error(), DurationMs: time.Since(t0).Milliseconds()}
				return
			}
			defer resp.Body.Close()

			body, _ := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
			results[i] = Result{
				URL:        parsed.String(),
				StatusCode: resp.StatusCode,
				Bytes:      len(body),
				DurationMs: time.Since(t0).Milliseconds(),
			}
		}(idx, rawURL)
	}

	wg.Wait()
	return results
}
