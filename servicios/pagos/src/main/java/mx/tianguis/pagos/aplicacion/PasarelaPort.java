package mx.tianguis.pagos.aplicacion;

import java.math.BigDecimal;
import mx.tianguis.pagos.dominio.MetodoPago;

/** Pasarela que cobra un monto por un medio de pago. */
public interface PasarelaPort {

    /**
     * Intenta cobrar.
     *
     * @param metodo medio de pago
     * @param monto monto en pesos
     * @return qué respondió la pasarela
     */
    ResultadoCobro cobrar(MetodoPago metodo, BigDecimal monto);
}
