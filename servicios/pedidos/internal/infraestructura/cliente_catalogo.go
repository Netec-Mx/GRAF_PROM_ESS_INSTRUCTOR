package infraestructura

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/aplicacion"
	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/dominio"
	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/metricas"
)

// maxCuerpoDeCatalogo acota cuánto se lee de una respuesta de catalogo.
const maxCuerpoDeCatalogo = 64 * 1024

// ClienteCatalogo consulta el servicio catalogo por HTTP. Implementa aplicacion.CatalogoPort.
type ClienteCatalogo struct {
	base    *url.URL
	cliente *http.Client
}

// productoDeCatalogo es el JSON que responde GET /productos/{sku}.
type productoDeCatalogo struct {
	SKU       string `json:"sku"`
	Nombre    string `json:"nombre"`
	PrecioMXN string `json:"precio_mxn"`
	Stock     int    `json:"stock"`
}

// NuevoClienteCatalogo crea el cliente. urlBase es por ejemplo http://catalogo:8000 y timeout
// es el tiempo máximo de cada consulta. Cada consulta se mide con las métricas de cliente.
func NuevoClienteCatalogo(urlBase string, timeout time.Duration, m *metricas.Metricas) (*ClienteCatalogo, error) {
	base, err := url.Parse(urlBase)
	if err != nil {
		return nil, fmt.Errorf("CATALOGO_URL inválida: %w", err)
	}
	if (base.Scheme != "http" && base.Scheme != "https") || base.Host == "" {
		return nil, fmt.Errorf("CATALOGO_URL inválida: %q debe ser http://host:puerto", urlBase)
	}
	return &ClienteCatalogo{
		base: base,
		cliente: &http.Client{
			Timeout:   timeout,
			Transport: &transporteMedido{siguiente: http.DefaultTransport, peer: metricas.PeerCatalogo, metricas: m},
			// catalogo no redirige. Si lo hiciera, no se sigue a ciegas.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}, nil
}

// ObtenerProducto consulta GET /productos/{sku}.
func (c *ClienteCatalogo) ObtenerProducto(ctx context.Context, sku string) (aplicacion.Producto, error) {
	destino := c.base.JoinPath("productos", url.PathEscape(sku)).String()
	peticion, err := http.NewRequestWithContext(ctx, http.MethodGet, destino, http.NoBody)
	if err != nil {
		return aplicacion.Producto{}, fmt.Errorf("%w: %w", aplicacion.ErrCatalogoNoDisponible, err)
	}
	peticion.Header.Set("Accept", "application/json")

	respuesta, err := c.cliente.Do(peticion)
	if err != nil {
		return aplicacion.Producto{}, fmt.Errorf("%w: %w", aplicacion.ErrCatalogoNoDisponible, err)
	}
	defer func() {
		// Se vacía el cuerpo para que la conexión se pueda reutilizar.
		_, _ = io.Copy(io.Discard, io.LimitReader(respuesta.Body, maxCuerpoDeCatalogo))
		_ = respuesta.Body.Close()
	}()

	switch respuesta.StatusCode {
	case http.StatusOK:
	case http.StatusNotFound:
		return aplicacion.Producto{}, aplicacion.ErrProductoNoExiste
	default:
		return aplicacion.Producto{}, fmt.Errorf("%w: respondió %d", aplicacion.ErrCatalogoNoDisponible, respuesta.StatusCode)
	}

	var cuerpo productoDeCatalogo
	if err := json.NewDecoder(io.LimitReader(respuesta.Body, maxCuerpoDeCatalogo)).Decode(&cuerpo); err != nil {
		return aplicacion.Producto{}, fmt.Errorf("%w: respuesta ilegible: %w", aplicacion.ErrCatalogoNoDisponible, err)
	}
	precio, err := dominio.DineroDesdeTexto(cuerpo.PrecioMXN)
	if err != nil {
		return aplicacion.Producto{}, fmt.Errorf("%w: %w", aplicacion.ErrCatalogoNoDisponible, err)
	}
	if cuerpo.SKU != sku || cuerpo.Stock < 0 {
		return aplicacion.Producto{}, fmt.Errorf("%w: respuesta inconsistente para %s", aplicacion.ErrCatalogoNoDisponible, sku)
	}
	return aplicacion.Producto{SKU: cuerpo.SKU, Nombre: cuerpo.Nombre, Precio: precio, Stock: cuerpo.Stock}, nil
}

// transporteMedido envuelve un http.RoundTripper y registra cada llamada en las métricas de
// cliente: cuenta por código de estado y duración.
type transporteMedido struct {
	siguiente http.RoundTripper
	peer      string
	metricas  *metricas.Metricas
}

// RoundTrip implementa http.RoundTripper.
func (t *transporteMedido) RoundTrip(peticion *http.Request) (*http.Response, error) {
	inicio := time.Now()
	respuesta, err := t.siguiente.RoundTrip(peticion)
	t.metricas.DuracionCliente.WithLabelValues(t.peer).Observe(time.Since(inicio).Seconds())

	estado := metricas.EstadoSinRespuesta
	if err == nil {
		estado = strconv.Itoa(respuesta.StatusCode)
	}
	t.metricas.PeticionesCliente.WithLabelValues(t.peer, estado).Inc()
	return respuesta, err
}
