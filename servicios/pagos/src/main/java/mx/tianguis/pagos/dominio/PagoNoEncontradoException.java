package mx.tianguis.pagos.dominio;

/** No existe un pago con ese id. */
public final class PagoNoEncontradoException extends DominioException {

    private static final long serialVersionUID = 1L;

    /**
     * Crea el error.
     *
     * @param dato id del pago
     */
    public PagoNoEncontradoException(String dato) {
        super("No existe un pago con id " + dato);
    }
}
