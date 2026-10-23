package metricas_test

import (
	"slices"
	"testing"

	dto "github.com/prometheus/client_model/go"

	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/aplicacion"
	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/metricas"
)

func familia(t *testing.T, m *metricas.Metricas, nombre string) *dto.MetricFamily {
	t.Helper()
	familias, err := m.Registro().Gather()
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range familias {
		if f.GetName() == nombre {
			return f
		}
	}
	t.Fatalf("no existe la métrica %s", nombre)
	return nil
}

func TestLaDuracionDeServidorEsNativaYClasicaALaVez(t *testing.T) {
	m := metricas.Nuevas()
	m.DuracionServidor.WithLabelValues("GET", "/pedidos/{id}").Observe(0.03)

	histograma := familia(t, m, "http_server_request_duration_seconds").GetMetric()[0].GetHistogram()

	var limites []float64
	for _, bucket := range histograma.GetBucket() {
		limites = append(limites, bucket.GetUpperBound())
	}
	esperados := []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5}
	if !slices.Equal(limites, esperados) {
		t.Errorf("buckets clásicos = %v, esperaba %v", limites, esperados)
	}
	// Factor 1.1 corresponde al esquema 3: cada bucket crece 2^(1/8), cerca de 1.09.
	if histograma.Schema == nil || histograma.GetSchema() != 3 {
		t.Errorf("esquema nativo = %v, esperaba 3", histograma.Schema)
	}
	if len(histograma.GetPositiveSpan()) == 0 {
		t.Errorf("el histograma no trae buckets nativos")
	}
}

func TestLaDuracionDeClienteEsSoloNativa(t *testing.T) {
	m := metricas.Nuevas()
	m.DuracionCliente.WithLabelValues(metricas.PeerCatalogo).Observe(0.03)

	histograma := familia(t, m, "http_client_request_duration_seconds").GetMetric()[0].GetHistogram()

	if len(histograma.GetBucket()) != 0 {
		t.Errorf("no debía tener buckets clásicos, tiene %d", len(histograma.GetBucket()))
	}
	if len(histograma.GetPositiveSpan()) == 0 || histograma.GetSampleCount() != 1 {
		t.Errorf("el histograma no trae la observación como bucket nativo")
	}
}

func TestLineasPorPedidoEsUnSummaryConTresCuantiles(t *testing.T) {
	m := metricas.Nuevas()
	for lineas := 1; lineas <= 100; lineas++ {
		m.PedidoGuardado(lineas)
	}

	resumen := familia(t, m, "orders_lines_per_order").GetMetric()[0].GetSummary()

	var cuantiles []float64
	for _, cuantil := range resumen.GetQuantile() {
		cuantiles = append(cuantiles, cuantil.GetQuantile())
	}
	if !slices.Equal(cuantiles, []float64{0.5, 0.9, 0.99}) {
		t.Errorf("cuantiles = %v", cuantiles)
	}
	if resumen.GetSampleCount() != 100 || resumen.GetSampleSum() != 5050 {
		t.Errorf("count = %d, sum = %v", resumen.GetSampleCount(), resumen.GetSampleSum())
	}
	if p90 := resumen.GetQuantile()[1].GetValue(); p90 < 88 || p90 > 92 {
		t.Errorf("p90 = %v, esperaba cerca de 90", p90)
	}
}

func TestLosResultadosDeNegocioExistenDesdeElArranque(t *testing.T) {
	m := metricas.Nuevas()

	creados := familia(t, m, "orders_created_total")

	var resultados []string
	for _, metrica := range creados.GetMetric() {
		resultados = append(resultados, metrica.GetLabel()[0].GetValue())
		if metrica.GetCounter().GetValue() != 0 {
			t.Errorf("la serie debía partir en cero")
		}
	}
	esperados := []string{"confirmed", "dependency_error", "rejected_out_of_stock", "rejected_unknown_sku"}
	if !slices.Equal(resultados, esperados) {
		t.Errorf("resultados = %v, esperaba %v", resultados, esperados)
	}

	m.IntentoDeCreacion(aplicacion.ResultadoConfirmado)
	if valor := familia(t, m, "orders_created_total").GetMetric()[0].GetCounter().GetValue(); valor != 1 {
		t.Errorf("confirmed = %v tras un intento", valor)
	}
}
