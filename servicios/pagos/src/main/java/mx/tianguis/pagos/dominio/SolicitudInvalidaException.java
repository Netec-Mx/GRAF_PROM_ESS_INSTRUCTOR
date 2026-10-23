package mx.tianguis.pagos.dominio;

/** La solicitud de pago no cumple las reglas. */
public final class SolicitudInvalidaException extends DominioException {

    private static final long serialVersionUID = 1L;

    /**
     * Crea el error.
     *
     * @param dato qué está mal
     */
    public SolicitudInvalidaException(String dato) {
        super(dato);
    }
}
