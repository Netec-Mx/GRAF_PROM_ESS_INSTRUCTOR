package mx.tianguis.pagos.dominio;

/** Ya se está procesando otro pago del mismo pedido. */
public final class PagoEnCursoException extends DominioException {

    private static final long serialVersionUID = 1L;

    /**
     * Crea el error.
     *
     * @param dato id del pedido
     */
    public PagoEnCursoException(String dato) {
        super("Ya hay un pago en curso para el pedido " + dato);
    }
}
