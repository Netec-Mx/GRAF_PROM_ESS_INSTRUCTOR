package mx.tianguis.pagos.telemetria;

import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.metrics.Meter;
import io.opentelemetry.api.metrics.ObservableLongGauge;
import java.util.Map;
import java.util.function.Supplier;

/**
 * La métrica chaos.active: una serie por falla de caos, 1 encendida y 0 apagada.
 *
 * <p>No lleva unidad a propósito. Con unidad "1", Prometheus le agregaría el sufijo _ratio al
 * recibirla por OTLP; sin unidad queda como chaos_active.
 */
public final class MetricasDeCaos {

    /**
     * Atributo con el tipo de falla. Se llama type, sin prefijo, para que en Prometheus la
     * etiqueta sea la misma que en catalogo, pedidos y conciliacion: chaos_active{type="..."}.
     */
    public static final AttributeKey<String> TIPO = AttributeKey.stringKey("type");

    private MetricasDeCaos() {}

    /**
     * Registra la métrica. El valor se lee de la fuente en cada exportación.
     *
     * @param medidor el medidor de OpenTelemetry
     * @param fuente por cada tipo de falla, si está encendida
     * @return el instrumento registrado
     */
    public static ObservableLongGauge publicar(Meter medidor, Supplier<Map<String, Boolean>> fuente) {
        return medidor.gaugeBuilder("chaos.active")
                .setDescription("Fallas de caos del servicio: 1 si está encendida, 0 si no.")
                .ofLongs()
                .buildWithCallback(medicion -> fuente.get()
                        .forEach((tipo, activa) -> medicion.record(activa ? 1 : 0, Attributes.of(TIPO, tipo))));
    }
}
