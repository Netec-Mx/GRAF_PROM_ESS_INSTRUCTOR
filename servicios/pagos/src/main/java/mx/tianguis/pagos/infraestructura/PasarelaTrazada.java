package mx.tianguis.pagos.infraestructura;

import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.instrumentation.annotations.WithSpan;
import java.math.BigDecimal;
import mx.tianguis.pagos.aplicacion.PasarelaPort;
import mx.tianguis.pagos.aplicacion.ResultadoCobro;
import mx.tianguis.pagos.dominio.MetodoPago;

/**
 * Decorador de la pasarela que abre el span pasarela.cobrar.
 *
 * <p>Es el más externo: todo lo que tarda el cobro, incluida una demora de caos, queda dentro
 * del span.
 */
public final class PasarelaTrazada implements PasarelaPort {

    private final PasarelaPort destino;

    /**
     * Crea el decorador.
     *
     * @param destino la pasarela cuyo cobro se mide
     */
    public PasarelaTrazada(PasarelaPort destino) {
        this.destino = destino;
    }

    @Override
    @WithSpan("pasarela.cobrar")
    public ResultadoCobro cobrar(MetodoPago metodo, BigDecimal monto) {
        Span span = Span.current();
        span.setAttribute("payment.method", metodo.codigo());

        ResultadoCobro resultado = destino.cobrar(metodo, monto);

        span.setAttribute("payment.result", resultado.codigo());
        if (resultado == ResultadoCobro.ERROR) {
            span.setStatus(StatusCode.ERROR, "la pasarela falló");
        }
        return resultado;
    }
}
