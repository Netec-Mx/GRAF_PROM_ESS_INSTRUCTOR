package mx.tianguis.pagos.infraestructura;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.random.RandomGenerator;
import mx.tianguis.pagos.aplicacion.PasarelaPort;
import mx.tianguis.pagos.aplicacion.ResultadoCobro;
import mx.tianguis.pagos.dominio.MetodoPago;
import org.junit.jupiter.api.Test;

/** El decorador de caos de la pasarela, con el azar y la espera inyectados. */
class PasarelaConCaosTest {

    private static final BigDecimal MONTO = new BigDecimal("100.00");

    /** Azar fijo: nextDouble() devuelve siempre el mismo sorteo. */
    private static final class AzarFijo implements RandomGenerator {

        private double sorteo;

        @Override
        public double nextDouble() {
            return sorteo;
        }

        @Override
        public long nextLong() {
            throw new UnsupportedOperationException("el decorador no debe usar nextLong");
        }
    }

    private final EstadoDeCaos estado = new EstadoDeCaos(InstantSource.system());
    private final AzarFijo azar = new AzarFijo();
    private final List<Duration> esperas = new ArrayList<>();
    private final List<MetodoPago> cobrosReales = new ArrayList<>();
    private final PasarelaPort destino = (metodo, monto) -> {
        cobrosReales.add(metodo);
        return ResultadoCobro.APROBADO;
    };
    private final PasarelaPort pasarela = new PasarelaConCaos(destino, estado, () -> azar, esperas::add);

    @Test
    void conTodoApagadoSoloPasaLaLlamada() {
        assertThat(pasarela.cobrar(MetodoPago.TARJETA, MONTO)).isEqualTo(ResultadoCobro.APROBADO);

        assertThat(esperas).isEmpty();
        assertThat(cobrosReales).containsExactly(MetodoPago.TARJETA);
    }

    @Test
    void pasarelaLentaEsperaLosMilisegundosPedidosYLuegoCobra() {
        estado.activar(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", 1500));

        assertThat(pasarela.cobrar(MetodoPago.SPEI, MONTO)).isEqualTo(ResultadoCobro.APROBADO);

        assertThat(esperas).containsExactly(Duration.ofMillis(1500));
        assertThat(cobrosReales).containsExactly(MetodoPago.SPEI);
    }

    @Test
    void pasarelaLentaRespetaElPorcentaje() {
        estado.activar(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", 1500, "porcentaje", 50));

        azar.sorteo = 0.499;
        pasarela.cobrar(MetodoPago.TARJETA, MONTO);
        azar.sorteo = 0.5;
        pasarela.cobrar(MetodoPago.TARJETA, MONTO);

        assertThat(esperas).hasSize(1);
        assertThat(cobrosReales).hasSize(2);
    }

    @Test
    void pasarelaLentaConMetodoSoloAfectaAEseMetodo() {
        estado.activar(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", 1500, "metodo", "oxxo"));

        pasarela.cobrar(MetodoPago.TARJETA, MONTO);
        assertThat(esperas).isEmpty();

        pasarela.cobrar(MetodoPago.OXXO, MONTO);
        assertThat(esperas).containsExactly(Duration.ofMillis(1500));
    }

    @Test
    void pasarelaErroresDevuelveErrorSinLlamarALaPasarelaDeVerdad() {
        estado.activar(EstadoDeCaos.PASARELA_ERRORES, Map.of());

        assertThat(pasarela.cobrar(MetodoPago.TARJETA, MONTO)).isEqualTo(ResultadoCobro.ERROR);

        assertThat(cobrosReales).isEmpty();
    }

    @Test
    void pasarelaErroresRespetaElPorcentajeYElMetodo() {
        estado.activar(EstadoDeCaos.PASARELA_ERRORES, Map.of("porcentaje", 50, "metodo", "spei"));

        azar.sorteo = 0.499;
        assertThat(pasarela.cobrar(MetodoPago.SPEI, MONTO)).isEqualTo(ResultadoCobro.ERROR);
        assertThat(pasarela.cobrar(MetodoPago.TARJETA, MONTO)).isEqualTo(ResultadoCobro.APROBADO);
        azar.sorteo = 0.5;
        assertThat(pasarela.cobrar(MetodoPago.SPEI, MONTO)).isEqualTo(ResultadoCobro.APROBADO);
    }

    @Test
    void lasDosFallasJuntasDemoranYLuegoFallan() {
        estado.activar(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", 200));
        estado.activar(EstadoDeCaos.PASARELA_ERRORES, Map.of());

        assertThat(pasarela.cobrar(MetodoPago.TARJETA, MONTO)).isEqualTo(ResultadoCobro.ERROR);

        assertThat(esperas).containsExactly(Duration.ofMillis(200));
    }

    @Test
    void siInterrumpenLaEsperaElCobroQuedaComoError() {
        estado.activar(EstadoDeCaos.PASARELA_LENTA, Map.of("ms", 200));
        PasarelaPort interrumpida = new PasarelaConCaos(destino, estado, () -> azar, duracion -> {
            throw new InterruptedException("corte de prueba");
        });

        assertThat(interrumpida.cobrar(MetodoPago.TARJETA, MONTO)).isEqualTo(ResultadoCobro.ERROR);

        assertThat(Thread.interrupted()).isTrue();
        assertThat(cobrosReales).isEmpty();
    }

    @Test
    void laTrazaEnvuelveAlCaosYDevuelveSuResultado() {
        estado.activar(EstadoDeCaos.PASARELA_ERRORES, Map.of());

        ResultadoCobro resultado = new PasarelaTrazada(pasarela).cobrar(MetodoPago.OXXO, MONTO);

        assertThat(resultado).isEqualTo(ResultadoCobro.ERROR);
    }
}
