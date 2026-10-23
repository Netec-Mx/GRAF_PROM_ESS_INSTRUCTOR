package mx.tianguis.pagos.aplicacion;

import mx.tianguis.pagos.dominio.EstadoPago;

/** Lo que puede responder la pasarela al cobrar. */
public enum ResultadoCobro {
    APROBADO("approved", EstadoPago.APROBADO),
    RECHAZADO_POR_FONDOS("declined", EstadoPago.RECHAZADO),
    ERROR("gateway_error", EstadoPago.ERROR_PASARELA);

    private final String codigo;
    private final EstadoPago estado;

    ResultadoCobro(String codigo, EstadoPago estado) {
        this.codigo = codigo;
        this.estado = estado;
    }

    /**
     * Valor del atributo payment.result en métricas, trazas y logs.
     *
     * @return el código en inglés
     */
    public String codigo() {
        return codigo;
    }

    /**
     * Estado con el que queda el pago.
     *
     * @return el estado
     */
    public EstadoPago estado() {
        return estado;
    }
}
