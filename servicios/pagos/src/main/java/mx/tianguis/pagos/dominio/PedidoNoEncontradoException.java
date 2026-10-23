package mx.tianguis.pagos.dominio;

/** El servicio pedidos no conoce ese pedido. */
public final class PedidoNoEncontradoException extends DominioException {

    private static final long serialVersionUID = 1L;

    /**
     * Crea el error.
     *
     * @param dato id del pedido
     */
    public PedidoNoEncontradoException(String dato) {
        super("No existe un pedido con id " + dato);
    }
}
