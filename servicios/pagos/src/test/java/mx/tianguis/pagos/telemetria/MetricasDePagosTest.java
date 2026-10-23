package mx.tianguis.pagos.telemetria;

import static io.opentelemetry.sdk.testing.assertj.OpenTelemetryAssertions.assertThat;

import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.sdk.metrics.SdkMeterProvider;
import io.opentelemetry.sdk.testing.exporter.InMemoryMetricReader;
import java.math.BigDecimal;
import mx.tianguis.pagos.aplicacion.ResultadoCobro;
import mx.tianguis.pagos.dominio.EstadoPago;
import mx.tianguis.pagos.dominio.MetodoPago;
import mx.tianguis.pagos.dominio.Pago;
import org.junit.jupiter.api.Test;

/** Las métricas manuales, leídas con el SDK de pruebas de OpenTelemetry. */
class MetricasDePagosTest {

    @Test
    void cadaPagoCuentaPorMetodoYResultadoYRegistraSuMonto() {
        InMemoryMetricReader lector = InMemoryMetricReader.create();
        try (SdkMeterProvider proveedor =
                SdkMeterProvider.builder().registerMetricReader(lector).build()) {
            MetricasDePagos metricas = new MetricasDePagos(proveedor.get(MetricasDePagos.NOMBRE_DEL_MEDIDOR));

            metricas.pagoProcesado(pago("PAG-000001", "275.50", MetodoPago.TARJETA, EstadoPago.APROBADO), ResultadoCobro.APROBADO);
            metricas.pagoProcesado(pago("PAG-000002", "89.00", MetodoPago.TARJETA, EstadoPago.APROBADO), ResultadoCobro.APROBADO);
            metricas.pagoProcesado(
                    pago("PAG-000003", "620.00", MetodoPago.SPEI, EstadoPago.RECHAZADO), ResultadoCobro.RECHAZADO_POR_FONDOS);

            assertThat(lector.collectAllMetrics())
                    .satisfiesExactlyInAnyOrder(
                            procesados -> assertThat(procesados)
                                    .hasName("payments.processed")
                                    .hasLongSumSatisfying(suma -> suma.isMonotonic()
                                            .hasPointsSatisfying(
                                                    punto -> punto.hasValue(2)
                                                            .hasAttributes(Attributes.of(
                                                                    MetricasDePagos.METODO, "tarjeta",
                                                                    MetricasDePagos.RESULTADO, "approved")),
                                                    punto -> punto.hasValue(1)
                                                            .hasAttributes(Attributes.of(
                                                                    MetricasDePagos.METODO, "spei",
                                                                    MetricasDePagos.RESULTADO, "declined")))),
                            montos -> assertThat(montos)
                                    .hasName("payments.amount")
                                    .hasUnit("mxn")
                                    .hasHistogramSatisfying(histograma -> histograma.hasPointsSatisfying(
                                            punto -> punto.hasCount(2)
                                                    .hasSum(364.5)
                                                    .hasBucketBoundaries(50, 100, 250, 500, 1000, 2500, 5000, 10000)
                                                    .hasAttributes(Attributes.of(MetricasDePagos.METODO, "tarjeta")),
                                            punto -> punto.hasCount(1)
                                                    .hasSum(620.0)
                                                    .hasAttributes(Attributes.of(MetricasDePagos.METODO, "spei")))));
        }
    }

    private static Pago pago(String id, String monto, MetodoPago metodo, EstadoPago estado) {
        return new Pago(id, "PED-000001", new BigDecimal(monto), metodo, estado, "2026-10-12T00:50:29Z");
    }
}
