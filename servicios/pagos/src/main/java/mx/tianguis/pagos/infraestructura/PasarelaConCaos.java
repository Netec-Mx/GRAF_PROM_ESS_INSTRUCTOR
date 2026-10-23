package mx.tianguis.pagos.infraestructura;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.Optional;
import java.util.function.Supplier;
import java.util.random.RandomGenerator;
import mx.tianguis.pagos.aplicacion.PasarelaPort;
import mx.tianguis.pagos.aplicacion.ResultadoCobro;
import mx.tianguis.pagos.dominio.MetodoPago;

/**
 * Decorador de la pasarela que le aplica las fallas de caos encendidas.
 *
 * <p>Va por dentro de {@link PasarelaTrazada}: la demora de pasarela_lenta queda dentro del span
 * pasarela.cobrar. Con todo apagado solo pasa la llamada a la pasarela de verdad.
 */
public final class PasarelaConCaos implements PasarelaPort {

    private final PasarelaPort destino;
    private final EstadoDeCaos estado;
    private final Supplier<RandomGenerator> azar;
    private final PasarelaSimulada.Pausa pausa;

    /**
     * Crea el decorador.
     *
     * @param destino la pasarela a la que se le aplican las fallas
     * @param estado qué fallas están encendidas
     * @param azar de dónde sale el generador de números al azar en cada llamada
     * @param pausa cómo se espera la demora de pasarela_lenta
     */
    public PasarelaConCaos(
            PasarelaPort destino, EstadoDeCaos estado, Supplier<RandomGenerator> azar, PasarelaSimulada.Pausa pausa) {
        this.destino = destino;
        this.estado = estado;
        this.azar = azar;
        this.pausa = pausa;
    }

    @Override
    public ResultadoCobro cobrar(MetodoPago metodo, BigDecimal monto) {
        Optional<EstadoDeCaos.Falla> lenta = estado.vigente(EstadoDeCaos.PASARELA_LENTA).filter(falla -> leToca(falla, metodo));
        if (lenta.isPresent()) {
            try {
                pausa.esperar(Duration.ofMillis(lenta.get().entero(EstadoDeCaos.MS)));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return ResultadoCobro.ERROR;
            }
        }
        if (estado.vigente(EstadoDeCaos.PASARELA_ERRORES).filter(falla -> leToca(falla, metodo)).isPresent()) {
            // La pasarela de verdad no se llama: el cobro falla sin haberse intentado.
            return ResultadoCobro.ERROR;
        }
        return destino.cobrar(metodo, monto);
    }

    private boolean leToca(EstadoDeCaos.Falla falla, MetodoPago metodo) {
        return falla.aplicaA(metodo) && azar.get().nextDouble() * 100 < falla.entero(EstadoDeCaos.PORCENTAJE);
    }
}
