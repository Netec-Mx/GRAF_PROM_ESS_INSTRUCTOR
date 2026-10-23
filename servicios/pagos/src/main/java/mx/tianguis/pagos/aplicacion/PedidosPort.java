package mx.tianguis.pagos.aplicacion;

/** Consulta al servicio pedidos. */
public interface PedidosPort {

    /**
     * Obtiene un pedido por su id.
     *
     * @param pedidoId id del pedido
     * @return el pedido
     * @throws mx.tianguis.pagos.dominio.PedidoNoEncontradoException si pedidos no lo conoce
     * @throws PedidosNoDisponibleException si pedidos no responde o responde con un error
     */
    PedidoConsultado obtener(String pedidoId);
}
