package mx.tianguis.pagos.infraestructura;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.function.Supplier;
import java.util.random.RandomGenerator;
import mx.tianguis.pagos.aplicacion.PasarelaPort;
import mx.tianguis.pagos.aplicacion.ResultadoCobro;
import mx.tianguis.pagos.dominio.MetodoPago;

/**
 * Pasarela de mentira, sin red: espera un rato y decide el resultado al azar según el método.
 *
 * <p>El azar y la espera se inyectan, así las pruebas son deterministas y no esperan de verdad.
 * El span pasarela.cobrar lo abre {@link PasarelaTrazada}, que la envuelve.
 */
public final class PasarelaSimulada implements PasarelaPort {

    /** Espera real: duerme el hilo. Con hilos virtuales no bloquea un hilo del sistema. */
    public static final Pausa PAUSA_REAL = duracion -> Thread.sleep(duracion);

    /** Fracción de llamadas lentas, en cualquier método. Son las que los exemplars dejan encontrar. */
    static final double PROBABILIDAD_LENTA = 0.02;

    static final int LENTA_MIN_MS = 1000;
    static final int LENTA_MAX_MS = 2000;

    private final Supplier<RandomGenerator> azar;
    private final Pausa pausa;

    /** Cómo se espera la latencia simulada. */
    @FunctionalInterface
    public interface Pausa {

        /**
         * Espera el tiempo indicado.
         *
         * @param duracion cuánto esperar
         * @throws InterruptedException si interrumpen la espera
         */
        void esperar(Duration duracion) throws InterruptedException;
    }

    /**
     * Latencia y probabilidades de un método de pago.
     *
     * @param minMs latencia mínima normal, en milisegundos
     * @param maxMs latencia máxima normal, en milisegundos
     * @param rechazo probabilidad de rechazo por fondos
     * @param error probabilidad de falla de la pasarela
     */
    record Perfil(int minMs, int maxMs, double rechazo, double error) {}

    /**
     * Crea la pasarela.
     *
     * @param azar de dónde sale el generador de números al azar en cada llamada
     * @param pausa cómo se espera la latencia
     */
    public PasarelaSimulada(Supplier<RandomGenerator> azar, Pausa pausa) {
        this.azar = azar;
        this.pausa = pausa;
    }

    static Perfil perfilDe(MetodoPago metodo) {
        return switch (metodo) {
            case TARJETA -> new Perfil(40, 250, 0.07, 0.02);
            case OXXO -> new Perfil(80, 400, 0.0, 0.02);
            case SPEI -> new Perfil(30, 150, 0.03, 0.01);
        };
    }

    @Override
    public ResultadoCobro cobrar(MetodoPago metodo, BigDecimal monto) {
        Perfil perfil = perfilDe(metodo);
        RandomGenerator generador = azar.get();

        try {
            pausa.esperar(Duration.ofMillis(latenciaMs(perfil, generador)));
            return decidir(perfil, generador.nextDouble());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return ResultadoCobro.ERROR;
        }
    }

    private static long latenciaMs(Perfil perfil, RandomGenerator generador) {
        if (generador.nextDouble() < PROBABILIDAD_LENTA) {
            return generador.nextInt(LENTA_MIN_MS, LENTA_MAX_MS + 1);
        }
        return generador.nextInt(perfil.minMs(), perfil.maxMs() + 1);
    }

    private static ResultadoCobro decidir(Perfil perfil, double sorteo) {
        if (sorteo < perfil.error()) {
            return ResultadoCobro.ERROR;
        }
        if (sorteo < perfil.error() + perfil.rechazo()) {
            return ResultadoCobro.RECHAZADO_POR_FONDOS;
        }
        return ResultadoCobro.APROBADO;
    }
}
