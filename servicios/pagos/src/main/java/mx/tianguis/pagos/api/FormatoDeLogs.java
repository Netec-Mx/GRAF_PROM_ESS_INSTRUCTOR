package mx.tianguis.pagos.api;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.event.KeyValuePair;
import org.springframework.boot.json.JsonWriter;
import org.springframework.boot.logging.structured.StructuredLogFormatter;

/**
 * Formato JSON de todos los logs del servicio, una línea por evento.
 *
 * <p>Cada línea lleva timestamp, level, service y msg. Si el log se escribe dentro de una
 * petición, lleva además el trace_id y el span_id del span activo, que es lo que permite
 * saltar del log a la traza.
 */
public final class FormatoDeLogs implements StructuredLogFormatter<ILoggingEvent> {

    /** Valor del campo service. */
    public static final String SERVICIO = "pagos";

    private final JsonWriter<Map<String, Object>> escritor = JsonWriter.standard();

    @Override
    public String format(ILoggingEvent evento) {
        Map<String, Object> linea = new LinkedHashMap<>();
        linea.put("timestamp", Instant.ofEpochMilli(evento.getTimeStamp()).toString());
        linea.put("level", nivel(evento.getLevel()));
        linea.put("service", SERVICIO);
        if (evento.getKeyValuePairs() != null) {
            for (KeyValuePair par : evento.getKeyValuePairs()) {
                linea.put(par.key, par.value);
            }
        }
        SpanContext span = Span.current().getSpanContext();
        if (span.isValid()) {
            linea.put("trace_id", span.getTraceId());
            linea.put("span_id", span.getSpanId());
        }
        linea.put("msg", evento.getFormattedMessage());
        linea.put("logger", evento.getLoggerName());
        if (evento.getThrowableProxy() != null) {
            linea.put("stack_trace", ThrowableProxyUtil.asString(evento.getThrowableProxy()));
        }
        return escritor.writeToString(linea) + System.lineSeparator();
    }

    private static String nivel(Level nivel) {
        if (nivel.isGreaterOrEqual(Level.ERROR)) {
            return "error";
        }
        if (nivel.isGreaterOrEqual(Level.WARN)) {
            return "warning";
        }
        return nivel.isGreaterOrEqual(Level.INFO) ? "info" : "debug";
    }
}
