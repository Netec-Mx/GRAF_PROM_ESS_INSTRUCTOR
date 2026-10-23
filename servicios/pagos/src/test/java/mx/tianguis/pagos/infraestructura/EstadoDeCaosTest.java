package mx.tianguis.pagos.infraestructura;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import mx.tianguis.pagos.dominio.MetodoPago;
import mx.tianguis.pagos.infraestructura.EstadoDeCaos.Descripcion;
import mx.tianguis.pagos.infraestructura.EstadoDeCaos.Falla;
import mx.tianguis.pagos.infraestructura.EstadoDeCaos.FallaDesconocidaException;
import mx.tianguis.pagos.infraestructura.EstadoDeCaos.ParametrosInvalidosException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

/** El estado de caos: validación, vencimiento con reloj falso y lo que deja en el log. */
@ExtendWith(OutputCaptureExtension.class)
class EstadoDeCaosTest {

    /** Reloj falso: avanza solo cuando la prueba lo dice. */
    private static final class RelojFalso implements InstantSource {

        private Instant ahora = Instant.parse("2026-10-12T12:00:00Z");

        @Override
        public Instant instant() {
            return ahora;
        }

        void avanzar(Duration lapso) {
            ahora = ahora.plus(lapso);
        }
    }

    private final RelojFalso reloj = new RelojFalso();
    private final EstadoDeCaos estado = new EstadoDeCaos(reloj);

    @Test
    void activarAplicaLosValoresPorDefecto() {
        Falla lenta = estado.activar(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", 1500));
        Falla errores = estado.activar(EstadoDeCaos.PASARELA_ERRORES, null);

        assertThat(lenta.enteros()).containsExactlyInAnyOrderEntriesOf(Map.of("ms", 1500, "porcentaje", 100));
        assertThat(lenta.metodo()).isNull();
        assertThat(lenta.vence()).isNull();
        assertThat(errores.enteros()).containsExactlyEntriesOf(Map.of("porcentaje", 100));
    }

    static Stream<Arguments> limitesValidos() {
        return Stream.of(
                Arguments.of(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", 100, "porcentaje", 1)),
                Arguments.of(
                        EstadoDeCaos.PASARELA_LENTA,
                        Map.of("ms", 10000, "porcentaje", 100, "metodo", "oxxo", "duracion_s", 86400)),
                Arguments.of(EstadoDeCaos.PASARELA_ERRORES, Map.of("porcentaje", 1, "metodo", "spei", "duracion_s", 1)),
                Arguments.of(EstadoDeCaos.PASARELA_ERRORES, Map.of()));
    }

    @ParameterizedTest
    @MethodSource("limitesValidos")
    void losLimitesDeCadaRangoSonValidos(String tipo, Map<String, Object> cuerpo) {
        estado.activar(tipo, cuerpo);

        assertThat(estado.vigente(tipo)).isPresent();
    }

    static Stream<Arguments> fueraDeContrato() {
        Map<String, Object> msNulo = new HashMap<>();
        msNulo.put("ms", null);
        return Stream.of(
                Arguments.of(EstadoDeCaos.PASARELA_LENTA, Map.of()),
                Arguments.of(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", 99)),
                Arguments.of(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", 10001)),
                Arguments.of(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", "1500")),
                Arguments.of(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", 1500.5)),
                Arguments.of(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", true)),
                Arguments.of(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", 3_000_000_000L)),
                Arguments.of(EstadoDeCaos.PASARELA_LENTA, msNulo),
                Arguments.of(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", 1500, "porcentaje", 0)),
                Arguments.of(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", 1500, "porcentaje", 101)),
                Arguments.of(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", 1500, "metodo", "efectivo")),
                Arguments.of(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", 1500, "metodo", 7)),
                Arguments.of(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", 1500, "duracion_s", 0)),
                Arguments.of(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", 1500, "duracion_s", 86401)),
                Arguments.of(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", 1500, "jitter_ms", 10)),
                Arguments.of(EstadoDeCaos.PASARELA_ERRORES, Map.of("ms", 1500)),
                Arguments.of(EstadoDeCaos.PASARELA_ERRORES, Map.of("porcentaje", 0)),
                Arguments.of(EstadoDeCaos.PASARELA_ERRORES, Map.of("status", 502)));
    }

    @ParameterizedTest
    @MethodSource("fueraDeContrato")
    void parametrosFueraDeContratoSeRechazanYNoEnciendenNada(String tipo, Map<String, Object> cuerpo) {
        assertThatThrownBy(() -> estado.activar(tipo, cuerpo)).isInstanceOf(ParametrosInvalidosException.class);

        assertThat(estado.vigente(tipo)).isEmpty();
    }

    @Test
    void unTipoQueNoExisteSeRechaza() {
        assertThatThrownBy(() -> estado.activar("latencia", Map.of("ms", 800)))
                .isInstanceOf(FallaDesconocidaException.class);
        assertThatThrownBy(() -> estado.apagar("latencia")).isInstanceOf(FallaDesconocidaException.class);
    }

    @Test
    void apagarUnaYApagarTodo() {
        estado.activar(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", 1500));
        estado.activar(EstadoDeCaos.PASARELA_ERRORES, Map.of());

        estado.apagar(EstadoDeCaos.PASARELA_LENTA);
        estado.apagar(EstadoDeCaos.PASARELA_LENTA);
        assertThat(estado.activas())
                .containsExactly(Map.entry("pasarela_lenta", false), Map.entry("pasarela_errores", true));

        estado.apagarTodo();
        assertThat(estado.activas()).containsExactly(Map.entry("pasarela_lenta", false), Map.entry("pasarela_errores", false));
    }

    @Test
    void elResumenTraeTodasLasFallasEnOrden() {
        estado.activar(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", 1500, "porcentaje", 30, "metodo", "tarjeta", "duracion_s", 90));

        List<Descripcion> resumen = estado.resumen();

        assertThat(resumen)
                .containsExactly(
                        new Descripcion(
                                "pasarela_lenta", true, 90L, Map.of("ms", 1500, "porcentaje", 30, "metodo", "tarjeta")),
                        new Descripcion("pasarela_errores", false, null, Map.of()));
    }

    @Test
    void conDuracionLaFallaSeApagaSola(CapturedOutput salida) {
        estado.activar(EstadoDeCaos.PASARELA_ERRORES, Map.of("duracion_s", 60));
        estado.activar(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", 1500));

        reloj.avanzar(Duration.ofSeconds(59));
        assertThat(estado.vigente(EstadoDeCaos.PASARELA_ERRORES)).isPresent();
        assertThat(estado.describir(EstadoDeCaos.PASARELA_ERRORES).restanteS()).isEqualTo(1L);
        assertThat(estado.barrer()).isEmpty();

        reloj.avanzar(Duration.ofSeconds(1));
        // Ya no aplica aunque nadie haya barrido todavía.
        assertThat(estado.vigente(EstadoDeCaos.PASARELA_ERRORES)).isEmpty();
        assertThat(estado.activas()).containsEntry("pasarela_errores", false);
        assertThat(salida.getOut()).doesNotContain("caos vencido");

        assertThat(estado.barrer()).containsExactly(EstadoDeCaos.PASARELA_ERRORES);
        assertThat(estado.barrer()).isEmpty();
        assertThat(salida.getOut()).containsOnlyOnce("caos vencido");
        // Una falla sin duracion_s no vence.
        reloj.avanzar(Duration.ofDays(365));
        assertThat(estado.vigente(EstadoDeCaos.PASARELA_LENTA)).isPresent();
    }

    @Test
    void cadaCambioDejaUnaLineaDeLog(CapturedOutput salida) {
        estado.activar(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", 1500, "duracion_s", 600));
        estado.apagar(EstadoDeCaos.PASARELA_LENTA);
        estado.apagar(EstadoDeCaos.PASARELA_LENTA);

        assertThat(salida.getOut()).containsOnlyOnce("caos activado").containsOnlyOnce("caos apagado");
    }

    @Test
    void laFallaSoloAlcanzaASuMetodo() {
        Falla soloOxxo = estado.activar(EstadoDeCaos.PASARELA_ERRORES, Map.of("metodo", "oxxo"));
        Falla todos = estado.activar(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", 1500));

        assertThat(soloOxxo.aplicaA(MetodoPago.OXXO)).isTrue();
        assertThat(soloOxxo.aplicaA(MetodoPago.TARJETA)).isFalse();
        assertThat(todos.aplicaA(MetodoPago.SPEI)).isTrue();
    }
}
