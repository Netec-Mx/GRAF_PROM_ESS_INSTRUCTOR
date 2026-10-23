package mx.tianguis.pagos.dominio;

/** El pedido existe pero no está confirmado. */
public final class PedidoNoConfirmadoException extends DominioException {

    private static final long serialVersionUID = 1L;

    /**
     * Crea el error.
     *
     * @param dato id del pedido
     */
    public PedidoNoConfirmadoException(String dato) {
        super("El pedido " + dato + " no está confirmado");
    }
}
