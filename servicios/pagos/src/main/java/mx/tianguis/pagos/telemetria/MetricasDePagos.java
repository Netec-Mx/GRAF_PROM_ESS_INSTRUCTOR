package mx.tianguis.pagos.telemetria;

import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.metrics.DoubleHistogram;
import io.opentelemetry.api.metrics.LongCounter;
import io.opentelemetry.api.metrics.Meter;
import java.util.List;
import mx.tianguis.pagos.aplicacion.ObservadorDePagos;
import mx.tianguis.pagos.aplicacion.ResultadoCobro;
import mx.tianguis.pagos.dominio.Pago;

/**
 * Definición única de las métricas de negocio de pagos.
 *
 * <p>Los nombres van en estilo OpenTelemetry, con puntos. Prometheus los traduce al recibirlos
 * por OTLP: payments.processed queda como payments_processed_total.
 */
public final class MetricasDePagos implements ObservadorDePagos {

    /** Nombre del medidor (scope) con el que se crean las métricas. */
    public static final String NOMBRE_DEL_MEDIDOR = "mx.tianguis.pagos";

    /** Atributo con el medio de pago: tarjeta, oxxo o spei. */
    public static final AttributeKey<String> METODO = AttributeKey.stringKey("payment.method");

    /** Atributo con el resultado: approved, declined o gateway_error. */
    public static final AttributeKey<String> RESULTADO = AttributeKey.stringKey("payment.result");

    /** Límites de los buckets del monto, en pesos. */
    static final List<Double> BUCKETS_DE_MONTO = List.of(50.0, 100.0, 250.0, 500.0, 1000.0, 2500.0, 5000.0, 10000.0);

    private final LongCounter procesados;
    private final DoubleHistogram montos;

    /**
     * Crea las métricas.
     *
     * @param medidor el medidor de OpenTelemetry
     */
    public MetricasDePagos(Meter medidor) {
        this.procesados = medidor.counterBuilder("payments.processed")
                .setDescription("Pagos que pasaron por la pasarela, por método y resultado.")
                .setUnit("{payment}")
                .build();
        this.montos = medidor.histogramBuilder("payments.amount")
                .setDescription("Monto de cada pago que pasó por la pasarela.")
                .setUnit("mxn")
                .setExplicitBucketBoundariesAdvice(BUCKETS_DE_MONTO)
                .build();
    }

    @Override
    public void pagoProcesado(Pago pago, ResultadoCobro resultado) {
        String metodo = pago.metodo().codigo();
        procesados.add(1, Attributes.of(METODO, metodo, RESULTADO, resultado.codigo()));
        // El double solo se usa para la métrica. El monto del pago sigue siendo BigDecimal.
        montos.record(pago.monto().doubleValue(), Attributes.of(METODO, metodo));
    }
}
