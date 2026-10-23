# Las versiones llegan desde infra/.env por los build args de infra/compose.yaml.
ARG GO_VERSION=1.27.2
# distroless no publica tags con versión, así que la imagen final se fija por digest.
ARG DISTROLESS_DIGEST=sha256:e2e927ec666bae08560abb3c55d0659eceabb657f56b6782ab500a9fc7f555e3

# Etapa 1: compila un binario estático.
FROM golang:${GO_VERSION}-alpine AS constructor
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /pedidos ./cmd/pedidos

# Etapa 2: imagen final sin shell ni gestor de paquetes, con usuario no root (uid 65532).
FROM gcr.io/distroless/static-debian13:nonroot@${DISTROLESS_DIGEST}
COPY --from=constructor /pedidos /pedidos
USER nonroot:nonroot
EXPOSE 8080
# No hay shell ni wget: el propio binario consulta /salud y sale con 0 o 1.
HEALTHCHECK --interval=10s --timeout=5s --retries=6 --start-period=20s \
    CMD ["/pedidos", "healthcheck"]
ENTRYPOINT ["/pedidos"]
