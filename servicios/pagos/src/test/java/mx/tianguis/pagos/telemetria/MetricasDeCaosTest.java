package mx.tianguis.pagos.telemetria;

import static io.opentelemetry.sdk.testing.assertj.OpenTelemetryAssertions.assertThat;

import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.metrics.ObservableLongGauge;
import io.opentelemetry.sdk.metrics.SdkMeterProvider;
import io.opentelemetry.sdk.testing.exporter.InMemoryMetricReader;
import java.time.InstantSource;
import java.util.Map;
import mx.tianguis.pagos.infraestructura.EstadoDeCaos;
import org.junit.jupiter.api.Test;

/** chaos.active leída con el SDK de pruebas de OpenTelemetry. */
class MetricasDeCaosTest {

    @Test
    void hayUnaSeriePorFallaYSigueAlEstado() {
        EstadoDeCaos estado = new EstadoDeCaos(InstantSource.system());
        InMemoryMetricReader lector = InMemoryMetricReader.create();
        try (SdkMeterProvider proveedor =
                        SdkMeterProvider.builder().registerMetricReader(lector).build();
                ObservableLongGauge metrica =
                        MetricasDeCaos.publicar(proveedor.get(MetricasDePagos.NOMBRE_DEL_MEDIDOR), estado::activas)) {
            assertThat(metrica).isNotNull();
            verificar(lector, 0, 0);

            estado.activar(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", 1500));
            verificar(lector, 1, 0);

            estado.apagarTodo();
            verificar(lector, 0, 0);
        }
    }

    private static void verificar(InMemoryMetricReader lector, long lenta, long errores) {
        assertThat(lector.collectAllMetrics())
                .satisfiesExactly(metrica -> assertThat(metrica)
                        .hasName("chaos.active")
                        .hasUnit("")
                        .hasLongGaugeSatisfying(gauge -> gauge.hasPointsSatisfying(
                                punto -> punto.hasValue(lenta)
                                        .hasAttributes(Attributes.of(MetricasDeCaos.TIPO, "pasarela_lenta")),
                                punto -> punto.hasValue(errores)
                                        .hasAttributes(Attributes.of(MetricasDeCaos.TIPO, "pasarela_errores")))));
    }
}
