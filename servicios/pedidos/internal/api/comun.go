// Package api contiene la entrada HTTP de pedidos: rutas, handlers y middlewares.
package api

import (
	"net/http"
	"strings"
)

const (
	// RutaDesconocida es el valor de route cuando la petición no coincide con ninguna ruta.
	RutaDesconocida = "unmatched"
	// MetodoOtro es el valor de method para cualquier método HTTP que no sea estándar.
	MetodoOtro = "OTHER"

	rutaSalud    = "/salud"
	rutaMetricas = "/metrics"
)

// Middleware envuelve un handler. Para sumar uno nuevo basta agregarlo a la lista que arma
// main; no hay que tocar las rutas ni los demás middlewares.
type Middleware func(http.Handler) http.Handler

// Encadenar aplica los middlewares a un handler. El primero de la lista queda más afuera.
func Encadenar(handler http.Handler, middlewares ...Middleware) http.Handler {
	for i := len(middlewares) - 1; i >= 0; i-- {
		handler = middlewares[i](handler)
	}
	return handler
}

// rutaExcluida dice si una petición queda fuera de las métricas HTTP y de los logs: /salud,
// /metrics y /caos con todo lo que cuelga de ella.
func rutaExcluida(peticion *http.Request) bool {
	ruta := peticion.URL.Path
	return ruta == rutaSalud || ruta == rutaMetricas || ruta == rutaCaos || strings.HasPrefix(ruta, rutaCaos+"/")
}

// metodoAcotado devuelve el método si es uno de los estándar y MetodoOtro si no. Sin esto,
// cada método inventado por un cliente crearía una serie nueva.
func metodoAcotado(metodo string) string {
	switch metodo {
	case http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut, http.MethodPatch,
		http.MethodDelete, http.MethodOptions, http.MethodConnect, http.MethodTrace:
		return metodo
	default:
		return MetodoOtro
	}
}

// plantillaDeRuta devuelve la plantilla con la que el ServeMux resolvió la petición, por
// ejemplo /pedidos/{id}, nunca la ruta real /pedidos/PED-000001. Solo vale después de que el
// ServeMux atendió la petición, porque es él quien llena Request.Pattern.
func plantillaDeRuta(peticion *http.Request) string {
	patron := peticion.Pattern
	if patron == "" {
		return RutaDesconocida
	}
	// El patrón trae el método delante: "GET /pedidos/{id}".
	if _, ruta, tieneMetodo := strings.Cut(patron, " "); tieneMetodo {
		return ruta
	}
	return patron
}

// rutaReal devuelve la ruta tal como llegó (/pedidos/PED-000001) si coincidió con alguna
// ruta. Solo la usa la falla cardinalidad. Las peticiones sin ruta siguen como RutaDesconocida.
func rutaReal(peticion *http.Request) string {
	if peticion.Pattern == "" {
		return RutaDesconocida
	}
	return peticion.URL.Path
}

// capturador recuerda el código de estado que escribió el handler.
type capturador struct {
	http.ResponseWriter
	estado int
}

func nuevoCapturador(w http.ResponseWriter) *capturador {
	return &capturador{ResponseWriter: w, estado: http.StatusOK}
}

// WriteHeader guarda el código de estado y lo pasa al ResponseWriter original.
func (c *capturador) WriteHeader(estado int) {
	c.estado = estado
	c.ResponseWriter.WriteHeader(estado)
}

// Unwrap permite que http.ResponseController llegue al ResponseWriter original.
func (c *capturador) Unwrap() http.ResponseWriter {
	return c.ResponseWriter
}
