// Package metricas define en un solo lugar todas las métricas de pedidos.
package metricas

import (
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"

	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/aplicacion"
)

// PeerCatalogo es el valor de la etiqueta peer para las llamadas al servicio catalogo.
const PeerCatalogo = "catalogo"

// EstadoSinRespuesta es el valor de la etiqueta status cuando la dependencia no respondió.
const EstadoSinRespuesta = "error"

// Parámetros de los histogramas nativos.
const (
	// Cada bucket nativo es a lo más un 10 % más ancho que el anterior.
	factorDeBucketNativo = 1.1
	// Tope de buckets nativos por serie. Si se supera, la librería baja la resolución.
	maxBucketsNativos = 160
	// Tiempo mínimo entre dos reinicios del histograma por exceso de buckets.
	minEntreReinicios = time.Hour
)

// bucketsClasicos son los mismos que usa catalogo, en segundos.
func bucketsClasicos() []float64 {
	return []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5}
}

// Metricas agrupa todas las métricas propias del servicio.
type Metricas struct {
	// Servidor HTTP. Mismos nombres que catalogo; se distinguen por la etiqueta job.
	PeticionesServidor *prometheus.CounterVec
	DuracionServidor   *prometheus.HistogramVec
	EnCurso            prometheus.Gauge

	// Cliente HTTP hacia otros servicios.
	PeticionesCliente *prometheus.CounterVec
	DuracionCliente   *prometheus.HistogramVec

	// Negocio.
	PedidosCreados   *prometheus.CounterVec
	LineasPorPedido  prometheus.Summary
	registroDeOrigen *prometheus.Registry
}

// FuenteDeCaos dice qué fallas de caos tiene el servicio y cuáles están encendidas.
type FuenteDeCaos interface {
	Tipos() []string
	Activa(tipo string) bool
}

// colectorDeCaos publica chaos_active leyendo la fuente en cada scrape.
type colectorDeCaos struct {
	fuente      FuenteDeCaos
	descripcion *prometheus.Desc
}

// Describe implementa prometheus.Collector.
func (c *colectorDeCaos) Describe(canal chan<- *prometheus.Desc) {
	canal <- c.descripcion
}

// Collect implementa prometheus.Collector. Saca una serie por falla: 1 encendida, 0 apagada.
func (c *colectorDeCaos) Collect(canal chan<- prometheus.Metric) {
	for _, tipo := range c.fuente.Tipos() {
		valor := 0.0
		if c.fuente.Activa(tipo) {
			valor = 1
		}
		canal <- prometheus.MustNewConstMetric(c.descripcion, prometheus.GaugeValue, valor, tipo)
	}
}

// PublicarCaos registra chaos_active, con una serie por cada falla de la fuente.
func (m *Metricas) PublicarCaos(fuente FuenteDeCaos) {
	m.registroDeOrigen.MustRegister(&colectorDeCaos{
		fuente: fuente,
		descripcion: prometheus.NewDesc("chaos_active",
			"Fallas de caos del servicio: 1 si está encendida, 0 si no.", []string{"type"}, nil),
	})
}

// Nuevas crea las métricas del servicio y las registra, junto con las de Go y del proceso,
// en un registro propio.
func Nuevas() *Metricas {
	registro := prometheus.NewRegistry()
	m := &Metricas{
		PeticionesServidor: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "http_server_requests_total",
			Help: "Peticiones HTTP atendidas, por método, plantilla de ruta y código de estado.",
		}, []string{"method", "route", "status"}),

		// Nativo y clásico a la vez: lleva Buckets y también NativeHistogramBucketFactor.
		DuracionServidor: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:                            "http_server_request_duration_seconds",
			Help:                            "Duración de las peticiones HTTP atendidas, en segundos.",
			Buckets:                         bucketsClasicos(),
			NativeHistogramBucketFactor:     factorDeBucketNativo,
			NativeHistogramMaxBucketNumber:  maxBucketsNativos,
			NativeHistogramMinResetDuration: minEntreReinicios,
		}, []string{"method", "route"}),

		EnCurso: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "http_server_requests_in_flight",
			Help: "Peticiones HTTP que se están atendiendo en este momento.",
		}),

		PeticionesCliente: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "http_client_requests_total",
			Help: "Peticiones HTTP hechas a otros servicios, por destino y código de estado. status=\"error\" si no hubo respuesta.",
		}, []string{"peer", "status"}),

		// Solo nativo: sin Buckets, la librería no expone buckets clásicos.
		DuracionCliente: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:                            "http_client_request_duration_seconds",
			Help:                            "Duración de las peticiones HTTP hechas a otros servicios, en segundos.",
			NativeHistogramBucketFactor:     factorDeBucketNativo,
			NativeHistogramMaxBucketNumber:  maxBucketsNativos,
			NativeHistogramMinResetDuration: minEntreReinicios,
		}, []string{"peer"}),

		PedidosCreados: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "orders_created_total",
			Help: "Intentos de crear un pedido, por resultado.",
		}, []string{"result"}),

		// Sin MaxAge: queda la ventana por defecto de la librería (10 minutos).
		LineasPorPedido: prometheus.NewSummary(prometheus.SummaryOpts{
			Name:       "orders_lines_per_order",
			Help:       "Número de líneas de cada pedido guardado.",
			Objectives: map[float64]float64{0.5: 0.05, 0.9: 0.01, 0.99: 0.001},
		}),

		registroDeOrigen: registro,
	}

	registro.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		m.PeticionesServidor, m.DuracionServidor, m.EnCurso,
		m.PeticionesCliente, m.DuracionCliente,
		m.PedidosCreados, m.LineasPorPedido,
	)

	// Las series de negocio existen desde el arranque, en cero, para que rate() no dé vacío.
	for _, resultado := range []aplicacion.Resultado{
		aplicacion.ResultadoConfirmado, aplicacion.ResultadoSKUInexistente,
		aplicacion.ResultadoSinStock, aplicacion.ResultadoErrorDeDependencia,
	} {
		m.PedidosCreados.WithLabelValues(string(resultado))
	}
	return m
}

// Registro devuelve el registro del que /metrics lee las métricas.
func (m *Metricas) Registro() prometheus.Gatherer {
	return m.registroDeOrigen
}

// IntentoDeCreacion implementa aplicacion.Observador.
func (m *Metricas) IntentoDeCreacion(resultado aplicacion.Resultado) {
	m.PedidosCreados.WithLabelValues(string(resultado)).Inc()
}

// PedidoGuardado implementa aplicacion.Observador.
func (m *Metricas) PedidoGuardado(lineas int) {
	m.LineasPorPedido.Observe(float64(lineas))
}
