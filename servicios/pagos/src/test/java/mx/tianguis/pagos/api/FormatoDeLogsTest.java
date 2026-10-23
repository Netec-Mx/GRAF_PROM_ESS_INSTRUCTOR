package mx.tianguis.pagos.api;

import static org.assertj.core.api.Assertions.assertThat;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.spi.LoggingEvent;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.context.Scope;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import org.junit.jupiter.api.Test;
import org.slf4j.event.KeyValuePair;

class FormatoDeLogsTest {

    private final FormatoDeLogs formato = new FormatoDeLogs();
    private final Logger logger = new LoggerContext().getLogger("mx.tianguis.pagos.Prueba");

    private LoggingEvent evento(Level nivel, String mensaje, Throwable causa) {
        LoggingEvent evento = new LoggingEvent(Logger.class.getName(), logger, nivel, mensaje, causa, null);
        evento.setTimeStamp(1_791_766_000_123L);
        return evento;
    }

    @Test
    void sinSpanActivoNoLlevaTraceId() {
        String linea = formato.format(evento(Level.INFO, "hola \"mundo\"", null));

        assertThat(linea)
                .isEqualTo("{\"timestamp\":\"2026-10-12T00:46:40.123Z\",\"level\":\"info\",\"service\":\"pagos\","
                        + "\"msg\":\"hola \\\"mundo\\\"\",\"logger\":\"mx.tianguis.pagos.Prueba\"}"
                        + System.lineSeparator());
    }

    @Test
    void dentroDeUnSpanLlevaSuTraceIdYSuSpanId() {
        try (SdkTracerProvider proveedor = SdkTracerProvider.builder().build()) {
            Span span = proveedor.get("prueba").spanBuilder("peticion").startSpan();
            try (Scope alcance = span.makeCurrent()) {
                LoggingEvent evento = evento(Level.WARN, "peticion atendida", null);
                evento.addKeyValuePair(new KeyValuePair("status", 404));
                evento.addKeyValuePair(new KeyValuePair("route", "/pagos/{id}"));

                String linea = formato.format(evento);

                assertThat(alcance).isNotNull();
                assertThat(linea)
                        .contains(
                                "\"level\":\"warning\"",
                                "\"status\":404",
                                "\"route\":\"/pagos/{id}\"",
                                "\"trace_id\":\"" + span.getSpanContext().getTraceId() + "\"",
                                "\"span_id\":\"" + span.getSpanContext().getSpanId() + "\"");
            } finally {
                span.end();
            }
        }
    }

    @Test
    void unErrorLlevaSuTrazaDePila() {
        String linea = formato.format(evento(Level.ERROR, "error interno", new IllegalStateException("se rompió")));

        assertThat(linea).contains("\"level\":\"error\"", "\"stack_trace\":\"java.lang.IllegalStateException: se rompió");
        assertThat(linea.lines()).hasSize(1);
    }
}
