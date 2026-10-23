package mx.tianguis.pagos.dominio;

/** El pedido ya tiene un pago aprobado. */
public final class PedidoYaPagadoException extends DominioException {

    private static final long serialVersionUID = 1L;

    /**
     * Crea el error.
     *
     * @param dato id del pedido
     */
    public PedidoYaPagadoException(String dato) {
        super("El pedido " + dato + " ya tiene un pago aprobado");
    }
}
