package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/aplicacion"
	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/dominio"
	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/metricas"
)

// maxCuerpoDePedido acota el tamaño del cuerpo de POST /pedidos.
const maxCuerpoDePedido = 64 * 1024

type manejadores struct {
	pedidos *aplicacion.Pedidos
	logger  *slog.Logger
}

// RutasDeNegocio devuelve las plantillas de las rutas de negocio. Son las únicas que el caos
// puede afectar.
func RutasDeNegocio() []string {
	return []string{"/pedidos", "/pedidos/{id}"}
}

// NuevasRutas registra las rutas del servicio en un ServeMux. Los middlewares se aplican
// aparte, con Encadenar.
//
// fallas decora solo los handlers de negocio; es por donde entra el caos. Con nil no hay
// fallas. /salud y /metrics nunca se decoran.
func NuevasRutas(pedidos *aplicacion.Pedidos, m *metricas.Metricas, logger *slog.Logger, fallas Middleware) *http.ServeMux {
	if fallas == nil {
		fallas = sinFallas
	}
	h := &manejadores{pedidos: pedidos, logger: logger}
	mux := http.NewServeMux()
	mux.Handle("POST /pedidos", fallas(http.HandlerFunc(h.crear)))
	mux.Handle("GET /pedidos", fallas(http.HandlerFunc(h.listar)))
	mux.Handle("GET /pedidos/{id}", fallas(http.HandlerFunc(h.obtener)))
	mux.HandleFunc("GET "+rutaSalud, h.salud)
	mux.Handle("GET "+rutaMetricas, promhttp.HandlerFor(m.Registro(), promhttp.HandlerOpts{}))
	return mux
}

type lineaEntrada struct {
	SKU      string `json:"sku"`
	Cantidad int    `json:"cantidad"`
}

type pedidoEntrada struct {
	Lineas []lineaEntrada `json:"lineas"`
}

type lineaSalida struct {
	SKU               string `json:"sku"`
	Cantidad          int    `json:"cantidad"`
	Nombre            string `json:"nombre,omitempty"`
	PrecioUnitarioMXN string `json:"precio_unitario_mxn,omitempty"`
	SubtotalMXN       string `json:"subtotal_mxn,omitempty"`
}

type pedidoSalida struct {
	ID             string        `json:"id"`
	Estado         string        `json:"estado"`
	Lineas         []lineaSalida `json:"lineas"`
	TotalMXN       string        `json:"total_mxn"`
	SKUsRechazados []string      `json:"skus_rechazados,omitempty"`
	CreadoEn       string        `json:"creado_en"`
}

type listaSalida struct {
	Total   int            `json:"total"`
	Pedidos []pedidoSalida `json:"pedidos"`
}

type errorSalida struct {
	Error   string `json:"error"`
	Mensaje string `json:"mensaje"`
}

func (h *manejadores) crear(w http.ResponseWriter, peticion *http.Request) {
	var entrada pedidoEntrada
	cuerpo := http.MaxBytesReader(w, peticion.Body, maxCuerpoDePedido)
	if err := json.NewDecoder(cuerpo).Decode(&entrada); err != nil {
		escribirError(w, h.logger, http.StatusBadRequest, "pedido_invalido", "El cuerpo debe ser un JSON como {\"lineas\":[{\"sku\":\"TNG-0001\",\"cantidad\":2}]}")
		return
	}
	solicitadas := make([]dominio.LineaSolicitada, 0, len(entrada.Lineas))
	for _, linea := range entrada.Lineas {
		solicitadas = append(solicitadas, dominio.LineaSolicitada{SKU: linea.SKU, Cantidad: linea.Cantidad})
	}

	pedido, resultado, err := h.pedidos.Crear(peticion.Context(), solicitadas)
	switch {
	case errors.Is(err, dominio.ErrPedidoInvalido):
		escribirError(w, h.logger, http.StatusBadRequest, "pedido_invalido", err.Error())
		return
	case err != nil:
		h.logger.LogAttrs(peticion.Context(), slog.LevelError, "pedido no creado",
			slog.String("result", string(resultado)),
			slog.Int("lines", len(solicitadas)),
			slog.String("error", err.Error()),
		)
		escribirError(w, h.logger, http.StatusServiceUnavailable, "catalogo_no_disponible",
			"No se pudo consultar el catálogo. El pedido no se creó; inténtalo de nuevo.")
		return
	}

	h.logger.LogAttrs(peticion.Context(), slog.LevelInfo, "pedido creado",
		slog.String("order_id", pedido.ID),
		slog.String("result", string(resultado)),
		slog.Int("lines", len(pedido.Lineas)),
		slog.String("total_mxn", pedido.Total.Texto()),
	)

	estado := http.StatusUnprocessableEntity
	if pedido.Estado == dominio.EstadoConfirmado {
		estado = http.StatusCreated
	}
	w.Header().Set("Location", "/pedidos/"+pedido.ID)
	escribirJSON(w, h.logger, estado, aSalida(pedido))
}

func (h *manejadores) obtener(w http.ResponseWriter, peticion *http.Request) {
	pedido, err := h.pedidos.Obtener(peticion.PathValue("id"))
	if err != nil {
		escribirError(w, h.logger, http.StatusNotFound, "pedido_no_encontrado", "No existe un pedido con ese id")
		return
	}
	escribirJSON(w, h.logger, http.StatusOK, aSalida(pedido))
}

func (h *manejadores) listar(w http.ResponseWriter, peticion *http.Request) {
	pedidos := h.pedidos.Listar(dominio.Estado(peticion.URL.Query().Get("estado")))
	salida := listaSalida{Total: len(pedidos), Pedidos: make([]pedidoSalida, 0, len(pedidos))}
	for _, pedido := range pedidos {
		salida.Pedidos = append(salida.Pedidos, aSalida(pedido))
	}
	escribirJSON(w, h.logger, http.StatusOK, salida)
}

func (h *manejadores) salud(w http.ResponseWriter, _ *http.Request) {
	escribirJSON(w, h.logger, http.StatusOK, map[string]string{"estado": "ok"})
}

func aSalida(pedido dominio.Pedido) pedidoSalida {
	lineas := make([]lineaSalida, 0, len(pedido.Lineas))
	for _, linea := range pedido.Lineas {
		salida := lineaSalida{SKU: linea.SKU, Cantidad: linea.Cantidad}
		if linea.ConPrecio {
			salida.Nombre = linea.Nombre
			salida.PrecioUnitarioMXN = linea.PrecioUnitario.Texto()
			salida.SubtotalMXN = linea.Subtotal().Texto()
		}
		lineas = append(lineas, salida)
	}
	return pedidoSalida{
		ID:             pedido.ID,
		Estado:         string(pedido.Estado),
		Lineas:         lineas,
		TotalMXN:       pedido.Total.Texto(),
		SKUsRechazados: pedido.SKUsRechazados,
		CreadoEn:       pedido.CreadoEn.UTC().Format(time.RFC3339),
	}
}

func escribirJSON(w http.ResponseWriter, logger *slog.Logger, estado int, cuerpo any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(estado)
	if err := json.NewEncoder(w).Encode(cuerpo); err != nil {
		logger.LogAttrs(context.Background(), slog.LevelError, "no se pudo escribir la respuesta",
			slog.String("error", err.Error()))
	}
}

func escribirError(w http.ResponseWriter, logger *slog.Logger, estado int, codigo, mensaje string) {
	escribirJSON(w, logger, estado, errorSalida{Error: codigo, Mensaje: mensaje})
}
