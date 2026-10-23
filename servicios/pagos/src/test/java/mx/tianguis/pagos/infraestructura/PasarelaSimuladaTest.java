package mx.tianguis.pagos.infraestructura;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.random.RandomGenerator;
import mx.tianguis.pagos.aplicacion.ResultadoCobro;
import mx.tianguis.pagos.dominio.MetodoPago;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/** Con el azar y la espera inyectados, la pasarela es determinista y no espera de verdad. */
class PasarelaSimuladaTest {

    private static final BigDecimal MONTO = new BigDecimal("100.00");

    /**
     * Azar de guion: nextDouble() devuelve los valores dados en orden, y nextInt(a, b) devuelve
     * a + fraccion * (b - a), con la fracción fijada en la prueba.
     */
    private static final class AzarDeGuion implements RandomGenerator {

        private final ArrayDeque<Double> dobles = new ArrayDeque<>();
        private final double fraccionDeLatencia;

        AzarDeGuion(double fraccionDeLatencia, double... dobles) {
            this.fraccionDeLatencia = fraccionDeLatencia;
            for (double valor : dobles) {
                this.dobles.add(valor);
            }
        }

        @Override
        public double nextDouble() {
            return dobles.removeFirst();
        }

        @Override
        public int nextInt(int origen, int limite) {
            return origen + (int) Math.round(fraccionDeLatencia * (limite - 1 - origen));
        }

        @Override
        public long nextLong() {
            throw new UnsupportedOperationException("la pasarela no debe usar nextLong");
        }
    }

    private final List<Duration> esperas = new ArrayList<>();

    private ResultadoCobro cobrar(MetodoPago metodo, double fraccionDeLatencia, double sorteoLenta, double sorteoResultado) {
        AzarDeGuion azar = new AzarDeGuion(fraccionDeLatencia, sorteoLenta, sorteoResultado);
        return new PasarelaSimulada(() -> azar, esperas::add).cobrar(metodo, MONTO);
    }

    @ParameterizedTest
    @CsvSource({
        // método, sorteo del resultado, resultado esperado
        "TARJETA, 0.0000, ERROR",
        "TARJETA, 0.0199, ERROR",
        "TARJETA, 0.0201, RECHAZADO_POR_FONDOS",
        "TARJETA, 0.0899, RECHAZADO_POR_FONDOS",
        "TARJETA, 0.0901, APROBADO",
        "TARJETA, 0.9999, APROBADO",
        "OXXO,    0.0199, ERROR",
        "OXXO,    0.0201, APROBADO",
        "SPEI,    0.0099, ERROR",
        "SPEI,    0.0101, RECHAZADO_POR_FONDOS",
        "SPEI,    0.0399, RECHAZADO_POR_FONDOS",
        "SPEI,    0.0401, APROBADO"
    })
    void elResultadoDependeDelMetodoYDelSorteo(MetodoPago metodo, double sorteo, ResultadoCobro esperado) {
        assertThat(cobrar(metodo, 0.5, 0.5, sorteo)).isEqualTo(esperado);
    }

    @ParameterizedTest
    @CsvSource({
        // método, latencia mínima, latencia máxima (milisegundos)
        "TARJETA, 40, 250",
        "OXXO,    80, 400",
        "SPEI,    30, 150"
    })
    void laLatenciaNormalEstaEnElRangoDelMetodo(MetodoPago metodo, long minimo, long maximo) {
        cobrar(metodo, 0.0, 0.5, 0.5);
        cobrar(metodo, 1.0, 0.5, 0.5);

        assertThat(esperas).containsExactly(Duration.ofMillis(minimo), Duration.ofMillis(maximo));
    }

    @Test
    void dosDeCadaCienLlamadasTardanEntreUnoYDosSegundos() {
        cobrar(MetodoPago.TARJETA, 0.0, 0.0199, 0.5);
        cobrar(MetodoPago.SPEI, 1.0, 0.0, 0.5);
        cobrar(MetodoPago.OXXO, 1.0, 0.02, 0.5);

        assertThat(esperas)
                .containsExactly(Duration.ofMillis(1000), Duration.ofMillis(2000), Duration.ofMillis(400));
    }

    @Test
    void laProporcionDeResultadosConAzarRealSeAcercaALaDelPerfil() {
        java.util.Random azar = new java.util.Random(20261011L);
        PasarelaSimulada pasarela = new PasarelaSimulada(() -> azar, esperas::add);
        int rechazos = 0;
        int errores = 0;
        int llamadas = 20_000;

        for (int i = 0; i < llamadas; i++) {
            ResultadoCobro resultado = pasarela.cobrar(MetodoPago.TARJETA, MONTO);
            rechazos += resultado == ResultadoCobro.RECHAZADO_POR_FONDOS ? 1 : 0;
            errores += resultado == ResultadoCobro.ERROR ? 1 : 0;
        }

        long lentas = esperas.stream().filter(espera -> espera.toMillis() >= 1000).count();
        assertThat(rechazos / (double) llamadas).isBetween(0.06, 0.08);
        assertThat(errores / (double) llamadas).isBetween(0.015, 0.025);
        assertThat(lentas / (double) llamadas).isBetween(0.015, 0.025);
        assertThat(esperas).allMatch(espera -> espera.toMillis() >= 40 && espera.toMillis() <= 2000);
    }

    @Test
    void siInterrumpenLaEsperaElCobroQuedaComoError() {
        PasarelaSimulada pasarela = new PasarelaSimulada(() -> new AzarDeGuion(0.5, 0.5, 0.5), duracion -> {
            throw new InterruptedException("prueba");
        });

        ResultadoCobro resultado = pasarela.cobrar(MetodoPago.TARJETA, MONTO);

        assertThat(resultado).isEqualTo(ResultadoCobro.ERROR);
        assertThat(Thread.interrupted()).isTrue();
    }
}
