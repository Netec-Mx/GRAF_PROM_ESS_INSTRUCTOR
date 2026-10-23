package api

import (
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/metricas"
)

// MiddlewareDeMetricas cuenta y mide cada petición con la plantilla de la ruta.
// /metrics, /salud y /caos quedan fuera.
//
// conRutaReal dice, en cada petición, si la etiqueta route lleva la ruta real en vez de la
// plantilla. Solo lo enciende la falla cardinalidad.
func MiddlewareDeMetricas(m *metricas.Metricas, conRutaReal func() bool) Middleware {
	return func(siguiente http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, peticion *http.Request) {
			if rutaExcluida(peticion) {
				siguiente.ServeHTTP(w, peticion)
				return
			}
			m.EnCurso.Inc()
			defer m.EnCurso.Dec()

			inicio := time.Now()
			respuesta := nuevoCapturador(w)
			siguiente.ServeHTTP(respuesta, peticion)
			duracion := time.Since(inicio).Seconds()

			metodo := metodoAcotado(peticion.Method)
			ruta := plantillaDeRuta(peticion)
			if conRutaReal() {
				ruta = rutaReal(peticion)
			}
			m.PeticionesServidor.WithLabelValues(metodo, ruta, strconv.Itoa(respuesta.estado)).Inc()
			m.DuracionServidor.WithLabelValues(metodo, ruta).Observe(duracion)
		})
	}
}

// MiddlewareDeLogs escribe una línea JSON por petición. /metrics, /salud y /caos quedan fuera.
func MiddlewareDeLogs(logger *slog.Logger) Middleware {
	return func(siguiente http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, peticion *http.Request) {
			if rutaExcluida(peticion) {
				siguiente.ServeHTTP(w, peticion)
				return
			}
			inicio := time.Now()
			respuesta := nuevoCapturador(w)
			siguiente.ServeHTTP(respuesta, peticion)
			duracion := time.Since(inicio)

			logger.LogAttrs(peticion.Context(), nivelDe(respuesta.estado), "peticion atendida",
				slog.String("method", metodoAcotado(peticion.Method)),
				slog.String("route", plantillaDeRuta(peticion)),
				slog.Int("status", respuesta.estado),
				slog.Float64("duration_ms", float64(duracion.Microseconds())/1000),
			)
		})
	}
}

// MiddlewareDeRecuperacion convierte un panic de un handler en una respuesta 500, para que
// la petición igual quede contada y registrada. Va más adentro que los otros dos.
func MiddlewareDeRecuperacion(logger *slog.Logger) Middleware {
	return func(siguiente http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, peticion *http.Request) {
			defer func() {
				causa := recover()
				if causa == nil {
					return
				}
				logger.LogAttrs(peticion.Context(), slog.LevelError, "panic en un handler",
					slog.Any("panic", causa))
				escribirError(w, logger, http.StatusInternalServerError, "error_interno", "Error interno del servicio")
			}()
			siguiente.ServeHTTP(w, peticion)
		})
	}
}

// nivelDe elige el nivel del log según el código de estado: info para 2xx y 3xx, warning
// para 4xx y error para 5xx.
func nivelDe(estado int) slog.Level {
	switch {
	case estado >= http.StatusInternalServerError:
		return slog.LevelError
	case estado >= http.StatusBadRequest:
		return slog.LevelWarn
	default:
		return slog.LevelInfo
	}
}
