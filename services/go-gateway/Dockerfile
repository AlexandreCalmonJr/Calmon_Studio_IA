FROM golang:1.23-alpine AS builder
WORKDIR /src
COPY go.mod ./
COPY main.go ./
COPY internal ./internal
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/jarvis-go-gateway .

FROM alpine:3.20
RUN adduser -D -u 10001 jarvis && apk add --no-cache ca-certificates wget
USER jarvis
COPY --from=builder /out/jarvis-go-gateway /usr/local/bin/jarvis-go-gateway
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1
ENTRYPOINT ["/usr/local/bin/jarvis-go-gateway"]
